import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { FileEntity, FileDocument } from './schemas/file.schema';
import { UploadFileDto } from './dto/upload-file.dto';
import { QueryFilesDto } from './dto/query-files.dto';
import { EncryptionService } from '../encryption/encryption.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/interfaces/audit.interface';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { FileUtil } from '../../shared/utils/file.util';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { Role } from '../permissions/constants/roles.enum';
import { FileAccessValidationService } from '../shares/services/file-access-validation.service';
import { FileAccessDocument } from '../shares/schemas/file-access.schema';
import { ShareAction } from '../shares/enums/share-permission.enum';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectModel(FileEntity.name)
    private readonly fileModel: Model<FileDocument>,
    private readonly encryptionService: EncryptionService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly fileAccessValidationService: FileAccessValidationService,
  ) {}

  /**
   * Upload and encrypt a file.
   *
   * Flow:
   * 1. Validate file type and size
   * 2. Generate a unique DEK for this file
   * 3. Encrypt the file data with the DEK
   * 4. Store encrypted file in storage
   * 5. Save metadata (with encrypted DEK) in MongoDB
   * 6. Log audit event
   */
  async uploadFile(
    file: Express.Multer.File,
    dto: UploadFileDto,
    user: AuthenticatedUser,
    ip: string,
  ): Promise<FileDocument> {
    // Validate MIME type
    if (!FileUtil.isAllowedMimeType(file.mimetype)) {
      throw new BadRequestException(
        `File type '${file.mimetype}' is not allowed`,
      );
    }

    // Generate checksum of original file
    const checksum = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    // Generate a unique DEK for this file
    const { keyId, key, encryptedKey } =
      await this.encryptionService.generateKey();

    // Encrypt the file data
    const { encryptedData, iv, authTag } = await this.encryptionService.encrypt(
      file.buffer,
      key,
    );

    // Generate storage path
    const fileUuid = uuidv4();
    const ext = FileUtil.getExtension(file.originalname);
    const storagePath = FileUtil.generateStoragePath(fileUuid, ext);

    // Store encrypted file
    await this.storageService.upload(storagePath, encryptedData);

    // Save metadata
    const fileDoc = await this.fileModel.create({
      uuid: fileUuid,
      originalName: FileUtil.sanitizeFilename(file.originalname),
      storagePath,
      mimeType: file.mimetype,
      size: file.size,
      checksum,
      encryptionKeyId: keyId,
      encryptedDek: encryptedKey.toString('hex'),
      encryptionIv: iv.toString('hex'),
      encryptionAuthTag: authTag.toString('hex'),
      uploadedBy: user.userId,
      accessLevel: dto.accessLevel || 'private',
      department: dto.department || null,
      description: dto.description || null,
    });

    // Audit log
    await this.auditService.log({
      action: AuditAction.FILE_UPLOAD,
      resource: 'file',
      resourceId: fileDoc.uuid,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,
      ipAddress: ip,
      metadata: {
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        accessLevel: dto.accessLevel || 'private',
      },
      status: 'success',
    });

    this.logger.log(
      `File uploaded: ${file.originalname} (${fileDoc.uuid}) by ${user.email}`,
    );
    return fileDoc;
  }

  /**
   * Download and decrypt a file.
   *
   * When access was granted by a share rather than by ownership, the share is
   * returned so the caller can call `recordShareDownload()` once the transfer
   * has actually completed. The counter is deliberately NOT incremented here —
   * nothing has been delivered to the client yet at this point.
   */
  async downloadFile(
    fileId: string,
    user: AuthenticatedUser,
    ip: string,
    deviceCertificateId?: string,
  ): Promise<{
    buffer: Buffer;
    file: FileDocument;
    share?: FileAccessDocument;
  }> {
    const { file, share } = await this.findFileWithAccessCheck(
      fileId,
      user,
      false,
      ShareAction.DOWNLOAD,
      deviceCertificateId,
    );

    // Read encrypted data from storage
    const encryptedData = await this.storageService.download(file.storagePath);

    // Decrypt the DEK
    const encryptedDek = Buffer.from(file.encryptedDek, 'hex');
    const dek = await this.encryptionService.decryptKey(encryptedDek);

    // Decrypt the file data
    const iv = Buffer.from(file.encryptionIv, 'hex');
    const authTag = Buffer.from(file.encryptionAuthTag, 'hex');
    const decryptedData = await this.encryptionService.decrypt(
      encryptedData,
      dek,
      iv,
      authTag,
    );

    // Verify checksum
    const checksum = crypto
      .createHash('sha256')
      .update(decryptedData)
      .digest('hex');

    if (checksum !== file.checksum) {
      this.logger.error(
        `Checksum mismatch for file ${file.uuid}! File may be corrupted.`,
      );
      throw new BadRequestException('File integrity check failed');
    }

    // Audit log
    await this.auditService.log({
      action: AuditAction.FILE_DOWNLOAD,
      resource: 'file',
      resourceId: file.uuid,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,
      ipAddress: ip,
      metadata: {
        fileName: file.originalName,
        ...(share ? { viaShareId: share._id.toString() } : {}),
      },
      status: 'success',
    });

    return { buffer: decryptedData, file, share };
  }

  /**
   * Record a completed download against the share that authorized it.
   *
   * Must only be called after the file has been transferred to the client
   * successfully — it consumes download quota and can revoke a one-time share.
   * Failures are logged, never propagated: the user already has the bytes, so
   * failing the request at this point would be misleading.
   */
  async recordShareDownload(shareId: string): Promise<void> {
    try {
      await this.fileAccessValidationService.recordDownload(shareId);
    } catch (error: any) {
      this.logger.error(
        `Failed to record download for share ${shareId}: ${error?.message}`,
      );
    }
  }

  /**
   * Get file metadata by ID or UUID.
   */
  async getFileMetadata(
    fileId: string,
    user: AuthenticatedUser,
  ): Promise<FileDocument> {
    const { file } = await this.findFileWithAccessCheck(
      fileId,
      user,
      false,
      ShareAction.VIEW,
    );
    return file;
  }

  /**
   * List files accessible to the user.
   */
  async listFiles(
    query: QueryFilesDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResponse<FileDocument>> {
    const {
      page = 1,
      limit = 20,
      search,
      mimeType,
      accessLevel,
      department,
    } = query;
    const filter: Record<string, any> = { isDeleted: false };

    // Access control: only admins see all files, others see own + internal/public
    const isAdmin = [Role.SUPER_ADMIN, Role.ADMIN].includes(user.role);
    if (!isAdmin) {
      filter.$or = [
        { uploadedBy: user.userId },
        { accessLevel: { $in: ['internal', 'public'] } },
      ];
    }

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.originalName = { $regex: escapedSearch, $options: 'i' };
    }
    if (mimeType) filter.mimeType = mimeType;
    if (accessLevel) filter.accessLevel = accessLevel;
    if (department) filter.department = department;

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.fileModel
        .find(filter)
        .select('-encryptedDek -encryptionIv -encryptionAuthTag -storagePath')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('uploadedBy', 'email firstName lastName')
        .exec(),
      this.fileModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data,
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

  /**
   * Soft delete a file.
   */
  async deleteFile(
    fileId: string,
    user: AuthenticatedUser,
    ip: string,
  ): Promise<void> {
    const { file } = await this.findFileWithAccessCheck(fileId, user, true);

    file.isDeleted = true;
    file.deletedAt = new Date();
    file.deletedBy = user.userId;
    await file.save();

    // Audit log
    await this.auditService.log({
      action: AuditAction.FILE_DELETE,
      resource: 'file',
      resourceId: file.uuid,
      userId: user.userId,
      userEmail: user.email,
      userRole: user.role,
      ipAddress: ip,
      metadata: { fileName: file.originalName },
      status: 'success',
    });

    this.logger.log(`File soft-deleted: ${file.uuid} by ${user.email}`);
  }

  /**
   * Find a file and check access permissions.
   *
   * Evaluation order (deliberate — do not reorder):
   *   1. The file OWNER and ADMIN / SUPER_ADMIN pass through immediately, before
   *      any share lookup. Owners never need a grant for their own file.
   *   2. The file's own accessLevel rules (internal / public / department) —
   *      these grant access without a share, as they always have.
   *   3. Only for a requester who is neither owner nor admin and whom the
   *      accessLevel rules do not already cover: consult
   *      FileAccessValidationService for an ACTIVE file_access grant. That call
   *      also enforces expiration, permission level, download caps and device
   *      pinning, and throws a 403 when there is no usable grant.
   *
   * @returns the file plus the share grant it was authorized by, if any. The
   *          share is what callers need in order to record a completed download.
   */
  private async findFileWithAccessCheck(
    fileId: string,
    user: AuthenticatedUser,
    ownerOrAdminOnly = false,
    action: ShareAction = ShareAction.VIEW,
    deviceCertificateId?: string,
  ): Promise<{ file: FileDocument; share?: FileAccessDocument }> {
    // Try to find by UUID first, then by MongoDB _id
    let file = await this.fileModel.findOne({ uuid: fileId, isDeleted: false });
    if (!file) {
      try {
        file = await this.fileModel.findOne({ _id: fileId, isDeleted: false });
      } catch {
        // Invalid ObjectId format — not found
      }
    }

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const isOwner = file.uploadedBy.toString() === user.userId;
    const isAdmin = [Role.SUPER_ADMIN, Role.ADMIN].includes(user.role);
    const isManager = user.role === Role.MANAGER;

    if (ownerOrAdminOnly) {
      if (!isOwner && !isAdmin) {
        throw new ForbiddenException(
          'You do not have permission to perform this action',
        );
      }
      return { file };
    }

    // ─── 1. Owner / admin bypass (before any share lookup) ───
    if (isOwner || isAdmin) {
      return { file };
    }

    // ─── 2. accessLevel rules ───────────────────────────────
    const allowedByAccessLevel =
      file.accessLevel === 'internal' ||
      file.accessLevel === 'public' ||
      (file.accessLevel === 'department' && isManager);

    if (allowedByAccessLevel) {
      return { file };
    }

    // ─── 3. Shared access grant ─────────────────────────────
    // Throws AccessDeniedException (403) when there is no ACTIVE grant, the
    // grant has expired, or its permission level does not cover `action`.
    const share = await this.fileAccessValidationService.validateAccess(
      file._id.toString(),
      user.userId,
      action,
      deviceCertificateId,
    );

    this.logger.log(
      `Shared access granted: file=${file.uuid} user=${user.email} ` +
        `action=${action} permission=${share.permission}`,
    );

    return { file, share };
  }
}
