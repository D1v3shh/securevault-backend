import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FileAccessEntity,
  FileAccessDocument,
} from '../schemas/file-access.schema';
import { FileEntity, FileDocument } from '../../files/schemas/file.schema';
import { UserEntity, UserDocument } from '../../users/schemas/user.schema';
import { ShareFileRequest } from '../dto/share-file-request.dto';
import { ShareFileResponse } from '../dto/share-file-response.dto';
import {
  QuerySharesDto,
  ShareSortField,
  SortOrder,
} from '../dto/query-shares.dto';
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
      throw new AccessDeniedException(
        'Only the file owner can share this file',
      );
    }

    // ─── 3. Validate target user ───────────────────────
    const targetUser = await this.userModel.findById(dto.sharedWithUserId);
    if (!targetUser || targetUser.deletedAt) {
      throw new InvalidShareRequestException('Target user not found');
    }

    if (!targetUser.isActive) {
      throw new InvalidShareRequestException(
        'Target user account is not active',
      );
    }

    // ─── 4. Cannot share with self ─────────────────────
    if (dto.sharedWithUserId === user.userId) {
      throw new InvalidShareRequestException(
        'Cannot share a file with yourself',
      );
    }

    // ─── 5. Validate expiration ────────────────────────
    const expiresAt = new Date(dto.expiresAt);
    if (isNaN(expiresAt.getTime())) {
      throw new InvalidShareRequestException('Invalid expiration date format');
    }

    if (expiresAt <= new Date()) {
      throw new InvalidShareRequestException(
        'Expiration date must be in the future',
      );
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

    this.logger.log(`Share revoked: shareId=${shareId} by ${user.email}`);
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
    return this.listShares({ ownerId: new Types.ObjectId(user.userId) }, query);
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
    const isSharedWith =
      share.sharedWithUserId?._id?.toString() === user.userId;

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
   * Fetch one page of shares with the file, owner and recipient refs resolved
   * in the database.
   *
   * Used whenever the request touches the file document — a name search, a name
   * sort, or both. One aggregate call returns rows and total via `$facet`, so
   * the query count does not grow with the page size.
   *
   * @param search when given, restricts results to files whose name matches;
   *               omitted for a pure file name sort, which must not filter.
   */
  private async aggregateSharePage(params: {
    filter: Record<string, any>;
    search?: string;
    sortBy: ShareSortField;
    direction: 1 | -1;
    skip: number;
    limit: number;
  }): Promise<{ data: any[]; total: number }> {
    const { filter, search, sortBy, direction, skip, limit } = params;
    const sortByFileName = sortBy === ShareSortField.FILE_NAME;

    const matchStages: any[] = [
      { $match: filter },
      {
        $lookup: {
          from: 'files',
          localField: 'fileId',
          foreignField: '_id',
          as: 'fileInfo',
        },
      },
      // Kept permissive so a share whose file document is missing is still
      // listed, exactly as the find + populate path lists it. The search
      // $match below excludes those rows on its own, since a missing name
      // cannot match a regex.
      { $unwind: { path: '$fileInfo', preserveNullAndEmptyArrays: true } },
    ];

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      matchStages.push({
        $match: {
          'fileInfo.originalName': { $regex: escapedSearch, $options: 'i' },
          'fileInfo.isDeleted': false,
        },
      });
    }

    const sortStage = sortByFileName
      ? { $sort: { 'fileInfo.originalName': direction } }
      : { $sort: { [sortBy]: direction } };

    const [result] = await this.fileAccessModel.aggregate(
      [
        ...matchStages,
        {
          $facet: {
            // Page rows. The user joins sit after $skip/$limit so they only
            // run for the rows actually being returned.
            data: [
              sortStage,
              { $skip: skip },
              { $limit: limit },
              {
                $lookup: {
                  from: 'users',
                  localField: 'ownerId',
                  foreignField: '_id',
                  as: 'ownerInfo',
                },
              },
              {
                $lookup: {
                  from: 'users',
                  localField: 'sharedWithUserId',
                  foreignField: '_id',
                  as: 'sharedWithInfo',
                },
              },
              {
                $unwind: {
                  path: '$ownerInfo',
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $unwind: {
                  path: '$sharedWithInfo',
                  preserveNullAndEmptyArrays: true,
                },
              },
              // Reshape into the same populated form ShareMapper expects from
              // .populate(), carrying only the fields the response needs.
              {
                $set: {
                  fileId: {
                    _id: '$fileInfo._id',
                    uuid: '$fileInfo.uuid',
                    originalName: '$fileInfo.originalName',
                    mimeType: '$fileInfo.mimeType',
                    size: '$fileInfo.size',
                  },
                  ownerId: {
                    _id: '$ownerInfo._id',
                    email: '$ownerInfo.email',
                    firstName: '$ownerInfo.firstName',
                    lastName: '$ownerInfo.lastName',
                  },
                  sharedWithUserId: {
                    _id: '$sharedWithInfo._id',
                    email: '$sharedWithInfo.email',
                    firstName: '$sharedWithInfo.firstName',
                    lastName: '$sharedWithInfo.lastName',
                  },
                },
              },
              { $unset: ['fileInfo', 'ownerInfo', 'sharedWithInfo'] },
            ],
            // Total matching the same filter, before pagination.
            meta: [{ $count: 'total' }],
          },
        },
      ],
      // Case-insensitive, accent-aware ordering for the name sort: bytewise
      // comparison would otherwise put every capitalised name before every
      // lowercase one, which reads as unsorted.
      sortByFileName ? { collation: { locale: 'en', strength: 2 } } : undefined,
    );

    return {
      data: result?.data ?? [],
      total: result?.meta?.[0]?.total ?? 0,
    };
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
    const direction: 1 | -1 = sortOrder === SortOrder.ASC ? 1 : -1;

    let data: any[];
    let total: number;

    // `originalName` lives on the file, not on the share, so both file name
    // search and file name sort need the file joined first — those go through
    // the aggregation. Everything else sorts on a field of file_access itself
    // and stays on the cheaper find + countDocuments path.
    const needsFileJoin =
      Boolean(search) || sortBy === ShareSortField.FILE_NAME;

    if (needsFileJoin) {
      ({ data, total } = await this.aggregateSharePage({
        filter,
        search,
        sortBy,
        direction,
        skip,
        limit,
      }));
    } else {
      const sort: Record<string, 1 | -1> = { [sortBy]: direction };

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
