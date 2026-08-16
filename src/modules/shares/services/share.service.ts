import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FileAccessEntity, FileAccessDocument } from '../schemas/file-access.schema';
import { FileEntity, FileDocument } from '../../files/schemas/file.schema';
import { UserEntity, UserDocument } from '../../users/schemas/user.schema';
import { ShareFileRequest } from '../dto/share-file-request.dto';
import { ShareFileResponse } from '../dto/share-file-response.dto';
import { QuerySharesDto, ShareSortField, SortOrder } from '../dto/query-shares.dto';
import { ShareStatus } from '../enums/share-status.enum';
import { ShareMapper } from '../mappers/share.mapper';
import { InvalidShareRequestException } from '../exceptions/invalid-share-request.exception';
import { ShareNotFoundException } from '../exceptions/share-not-found.exception';
import { AccessDeniedException } from '../exceptions/access-denied.exception';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../audit/interfaces/audit.interface';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { PaginatedResponse } from '../../../common/dto/pagination.dto';
import { SharedFileResponse } from '../dto/shared-file-response.dto';

/**
 * Core service for managing file shares.
 *
 * Responsibilities:
 *   - Create shares with full validation
 *   - Revoke shares
 *   - List shares (shared-with-me, shared-by-me)
 *   - Audit logging for all share lifecycle events
 */
@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);

  constructor(
    @InjectModel(FileAccessEntity.name)
    private readonly fileAccessModel: Model<FileAccessDocument>,
    @InjectModel(FileEntity.name)
    private readonly fileModel: Model<FileDocument>,
    @InjectModel(UserEntity.name)
    private readonly userModel: Model<UserDocument>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Share a file with another user.
   *
   * Validations:
   *   1. File must exist and not be deleted
   *   2. Requesting user must own the file (never trust client-supplied ownerId)
   *   3. Target user must exist and be active
   *   4. Target user cannot be the owner
   *   5. Expiration timestamp must be in the future
   *   6. No duplicate active shares for the same file + user
   */
  async shareFile(
    dto: ShareFileRequest,
    user: AuthenticatedUser,
    ip: string,
  ): Promise<ShareFileResponse> {
    // ─── 1. Resolve and validate the file ──────────────
    const file = await this.resolveFile(dto.fileId);

    if (!file) {
      throw new InvalidShareRequestException('File not found');
    }

    if (file.isDeleted) {
      throw new InvalidShareRequestException('Cannot share a deleted file');
    }

    // ─── 2. Validate ownership (from database, not client) ─
    const isOwner = file.uploadedBy.toString() === user.userId;
    if (!isOwner) {
      this.logger.warn(
        `Share attempt by non-owner: user=${user.userId}, file=${dto.fileId}`,
      );
      throw new AccessDeniedException('Only the file owner can share this file');
    }

    // ─── 3. Validate target user ───────────────────────
    const targetUser = await this.userModel.findById(dto.sharedWithUserId);
    if (!targetUser || targetUser.deletedAt) {
      throw new InvalidShareRequestException('Target user not found');
    }

    if (!targetUser.isActive) {
      throw new InvalidShareRequestException('Target user account is not active');
    }

    // ─── 4. Cannot share with self ─────────────────────
    if (dto.sharedWithUserId === user.userId) {
      throw new InvalidShareRequestException('Cannot share a file with yourself');
    }

    // ─── 5. Validate expiration ────────────────────────
    const expiresAt = new Date(dto.expiresAt);
    if (isNaN(expiresAt.getTime())) {
      throw new InvalidShareRequestException('Invalid expiration date format');
    }

    if (expiresAt <= new Date()) {
      throw new InvalidShareRequestException('Expiration date must be in the future');
    }

    // ─── 6. Check for duplicate active share ───────────
    const existingShare = await this.fileAccessModel.findOne({
      fileId: file._id,
      sharedWithUserId: new Types.ObjectId(dto.sharedWithUserId),
      status: ShareStatus.ACTIVE,
    });

    if (existingShare) {
      throw new InvalidShareRequestException(
        'An active share already exists for this file and user. Revoke the existing share first.',
      );
    }

    // ─── Create the share record ───────────────────────
    const now = new Date();
    const shareDoc = await this.fileAccessModel.create({
      fileId: file._id,
      ownerId: new Types.ObjectId(user.userId),
      sharedWithUserId: new Types.ObjectId(dto.sharedWithUserId),
      permission: dto.permission,
      status: ShareStatus.ACTIVE,
      sharedAt: now,
      expiresAt,
      maxDownloads: dto.maxDownloads ?? null,
      downloadCount: 0,
      oneTimeAccess: dto.oneTimeAccess ?? false,
      watermarkEnabled: dto.watermarkEnabled ?? false,
      allowedDeviceCertificateId: dto.allowedDeviceCertificateId ?? null,
    });

    // ─── Audit log ─────────────────────────────────────
    await this.auditService.log({
      action: AuditAction.FILE_SHARE,
      resource: 'file_access',
      resourceId: shareDoc._id.toString(),
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,
      ipAddress: ip,
      metadata: {
        event: 'share_created',
        fileId: file.uuid,
        fileName: file.originalName,
        sharedWithUserId: dto.sharedWithUserId,
        sharedWithEmail: targetUser.email,
        permission: dto.permission,
        expiresAt: expiresAt.toISOString(),
        maxDownloads: dto.maxDownloads ?? null,
        oneTimeAccess: dto.oneTimeAccess ?? false,
      },
      status: 'success',
    });

    this.logger.log(
      `File shared: ${file.originalName} (${file.uuid}) → ${targetUser.email} [${dto.permission}] by ${user.email}`,
    );

    return ShareMapper.toShareFileResponse(shareDoc);
  }

  /**
   * Revoke a file share.
   *
   * Only the file owner or an admin can revoke.
   * Status is set to REVOKED; access becomes invalid immediately.
   */
  async revokeShare(
    shareId: string,
    user: AuthenticatedUser,
    ip: string,
  ): Promise<void> {
    const share = await this.fileAccessModel.findById(shareId);

    if (!share) {
      throw new ShareNotFoundException();
    }

    // Only owner can revoke (admins handled at controller guard level)
    const isOwner = share.ownerId.toString() === user.userId;
    if (!isOwner) {
      throw new AccessDeniedException('Only the file owner can revoke a share');
    }

    if (share.status === ShareStatus.REVOKED) {
      throw new InvalidShareRequestException('Share is already revoked');
    }

    share.status = ShareStatus.REVOKED;
    await share.save();

    // Audit log
    await this.auditService.log({
      action: AuditAction.FILE_SHARE,
      resource: 'file_access',
      resourceId: share._id.toString(),
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,
      ipAddress: ip,
      metadata: {
        event: 'share_revoked',
        fileId: share.fileId.toString(),
        sharedWithUserId: share.sharedWithUserId.toString(),
        previousStatus: ShareStatus.ACTIVE,
      },
      status: 'success',
    });

    this.logger.log(
      `Share revoked: shareId=${shareId} by ${user.email}`,
    );
  }

  /**
   * List files shared WITH the current user.
   * Returns only active shares by default (with lazy expiration applied).
   */
  async getSharedWithMe(
    query: QuerySharesDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResponse<SharedFileResponse>> {
    return this.listShares(
      { sharedWithUserId: new Types.ObjectId(user.userId) },
      query,
    );
  }

  /**
   * List files shared BY the current user.
   * Returns only active shares by default.
   */
  async getSharedByMe(
    query: QuerySharesDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResponse<SharedFileResponse>> {
    return this.listShares(
      { ownerId: new Types.ObjectId(user.userId) },
      query,
    );
  }

  /**
   * Get a single share record by ID (for the owner or the shared-with user).
   */
  async getShareById(
    shareId: string,
    user: AuthenticatedUser,
  ): Promise<SharedFileResponse> {
    const share = await this.fileAccessModel
      .findById(shareId)
      .populate('fileId', 'uuid originalName mimeType size')
      .populate('ownerId', 'email firstName lastName')
      .populate('sharedWithUserId', 'email firstName lastName')
      .exec();

    if (!share) {
      throw new ShareNotFoundException();
    }

    // Only owner or shared-with user can view
    const isOwner = share.ownerId?._id?.toString() === user.userId;
    const isSharedWith = share.sharedWithUserId?._id?.toString() === user.userId;

    if (!isOwner && !isSharedWith) {
      throw new AccessDeniedException();
    }

    return ShareMapper.toSharedFileResponse(share);
  }

  // ─── Private Helpers ──────────────────────────────────

  /**
   * Resolve a file by UUID or MongoDB _id.
   */
  private async resolveFile(fileId: string): Promise<FileDocument | null> {
    let file = await this.fileModel.findOne({ uuid: fileId });
    if (!file) {
      try {
        file = await this.fileModel.findById(fileId);
      } catch {
        // Invalid ObjectId format
      }
    }
    return file;
  }

  /**
   * Generic list shares with pagination, sorting, and filtering.
   */
  private async listShares(
    baseFilter: Record<string, any>,
    query: QuerySharesDto,
  ): Promise<PaginatedResponse<SharedFileResponse>> {
    const {
      page = 1,
      limit = 20,
      status,
      sortBy = ShareSortField.CREATED_AT,
      sortOrder = SortOrder.DESC,
      search,
    } = query;

    const filter: Record<string, any> = { ...baseFilter };

    // Default to ACTIVE only
    filter.status = status ?? ShareStatus.ACTIVE;

    const skip = (page - 1) * limit;

    // Build sort object
    const sort: Record<string, 1 | -1> = {};
    if (sortBy === ShareSortField.FILE_NAME) {
      // File name sort requires a pipeline, we handle it with population
      // For now, default to createdAt
      sort.createdAt = sortOrder === SortOrder.ASC ? 1 : -1;
    } else {
      sort[sortBy] = sortOrder === SortOrder.ASC ? 1 : -1;
    }

    // If searching by file name, we need to use aggregation
    let data: any[];
    let total: number;

    if (search) {
      // Use aggregation pipeline for file name search
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const pipeline: any[] = [
        { $match: filter },
        {
          $lookup: {
            from: 'files',
            localField: 'fileId',
            foreignField: '_id',
            as: 'fileInfo',
          },
        },
        { $unwind: '$fileInfo' },
        {
          $match: {
            'fileInfo.originalName': { $regex: escapedSearch, $options: 'i' },
            'fileInfo.isDeleted': false,
          },
        },
      ];

      // Count total
      const countResult = await this.fileAccessModel.aggregate([
        ...pipeline,
        { $count: 'total' },
      ]);
      total = countResult[0]?.total ?? 0;

      // Sort
      if (sortBy === ShareSortField.FILE_NAME) {
        pipeline.push({ $sort: { 'fileInfo.originalName': sortOrder === SortOrder.ASC ? 1 : -1 } });
      } else {
        pipeline.push({ $sort: sort });
      }

      // Paginate
      pipeline.push({ $skip: skip }, { $limit: limit });

      const rawResults = await this.fileAccessModel.aggregate(pipeline);

      // Populate user fields manually
      const populatedData = await Promise.all(
        rawResults.map(async (item) => {
          const doc = await this.fileAccessModel
            .findById(item._id)
            .populate('fileId', 'uuid originalName mimeType size')
            .populate('ownerId', 'email firstName lastName')
            .populate('sharedWithUserId', 'email firstName lastName')
            .exec();
          return doc;
        }),
      );

      data = populatedData.filter(Boolean);
    } else {
      // Standard query without search
      [data, total] = await Promise.all([
        this.fileAccessModel
          .find(filter)
          .populate('fileId', 'uuid originalName mimeType size')
          .populate('ownerId', 'email firstName lastName')
          .populate('sharedWithUserId', 'email firstName lastName')
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .exec(),
        this.fileAccessModel.countDocuments(filter),
      ]);
    }

    const mappedData = ShareMapper.toSharedFileResponseList(data);
    const totalPages = Math.ceil(total / limit);

    return {
      data: mappedData,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }
}
