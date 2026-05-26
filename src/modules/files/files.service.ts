import {
  Injectable, Logger, NotFoundException, ForbiddenException,
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
      throw new BadRequestException(`File type '${file.mimetype}' is not allowed`);
    }

    // Generate checksum of original file
    const checksum = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    // Generate a unique DEK for this file
    const { keyId, key, encryptedKey } = await this.encryptionService.generateKey();

    // Encrypt the file data
    const { encryptedData, iv, authTag } = await this.encryptionService.encrypt(file.buffer, key);

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

    this.logger.log(`File uploaded: ${file.originalname} (${fileDoc.uuid}) by ${user.email}`);
    return fileDoc;
  }

  /**
   * Download and decrypt a file.
   */
  async downloadFile(
    fileId: string,
    user: AuthenticatedUser,
    ip: string,
  ): Promise<{ buffer: Buffer; file: FileDocument }> {
    const file = await this.findFileWithAccessCheck(fileId, user);

    // Read encrypted data from storage
    const encryptedData = await this.storageService.download(file.storagePath);

    // Decrypt the DEK
    const encryptedDek = Buffer.from(file.encryptedDek, 'hex');
    const dek = await this.encryptionService.decryptKey(encryptedDek);

    // Decrypt the file data
    const iv = Buffer.from(file.encryptionIv, 'hex');
    const authTag = Buffer.from(file.encryptionAuthTag, 'hex');
    const decryptedData = await this.encryptionService.decrypt(encryptedData, dek, iv, authTag);

    // Verify checksum
    const checksum = crypto
      .createHash('sha256')
      .update(decryptedData)
      .digest('hex');

    if (checksum !== file.checksum) {
      this.logger.error(`Checksum mismatch for file ${file.uuid}! File may be corrupted.`);
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
      metadata: { fileName: file.originalName },
      status: 'success',
    });

    return { buffer: decryptedData, file };
  }

  /**
   * Get file metadata by ID or UUID.
   */
  async getFileMetadata(fileId: string, user: AuthenticatedUser): Promise<FileDocument> {
    return this.findFileWithAccessCheck(fileId, user);
  }

  /**
   * List files accessible to the user.
   */
  async listFiles(
    query: QueryFilesDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResponse<FileDocument>> {
    const { page = 1, limit = 20, search, mimeType, accessLevel, department } = query;
    const filter: Record<string, any> = { isDeleted: false };

    // Access control: only admins see all files, others see own + internal/public
    const isAdmin = [Role.SUPER_ADMIN, Role.ADMIN].includes(user.role as Role);
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
    const file = await this.findFileWithAccessCheck(fileId, user, true);

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
   */
  private async findFileWithAccessCheck(
    fileId: string,
    user: AuthenticatedUser,
    ownerOrAdminOnly = false,
  ): Promise<FileDocument> {
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
    const isAdmin = [Role.SUPER_ADMIN, Role.ADMIN].includes(user.role as Role);
    const isManager = user.role === Role.MANAGER;

    if (ownerOrAdminOnly) {
      if (!isOwner && !isAdmin) {
        throw new ForbiddenException('You do not have permission to perform this action');
      }
      return file;
    }

    // Access control checks
    if (file.accessLevel === 'private' && !isOwner && !isAdmin) {
      throw new ForbiddenException('You do not have access to this file');
    }

    if (file.accessLevel === 'department') {
      // Department-level access — managers and admins can access
      if (!isOwner && !isAdmin && !isManager) {
        throw new ForbiddenException('You do not have access to this file');
      }
    }

    return file;
  }
}
