import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FileAccessEntity,
  FileAccessDocument,
} from '../schemas/file-access.schema';
import { FileEntity, FileDocument } from '../../files/schemas/file.schema';
import { ShareStatus } from '../enums/share-status.enum';
import {
  SharePermission,
  ShareAction,
  hasPermissionForAction,
} from '../enums/share-permission.enum';
import { AccessDeniedException } from '../exceptions/access-denied.exception';
import { ShareExpiredException } from '../exceptions/share-expired.exception';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../audit/interfaces/audit.interface';

/**
 * Service responsible for validating file access permissions.
 *
 * Every file operation that involves shared access must pass through
 * this service. It enforces:
 *   - Active share record exists
 *   - Share status is ACTIVE
 *   - Current time is before expiration (lazy expiration)
 *   - User permission allows the requested action
 *   - Enterprise controls (download limits, one-time access, device restriction)
 */
@Injectable()
export class FileAccessValidationService {
  private readonly logger = new Logger(FileAccessValidationService.name);

  constructor(
    @InjectModel(FileAccessEntity.name)
    private readonly fileAccessModel: Model<FileAccessDocument>,
    @InjectModel(FileEntity.name)
    private readonly fileModel: Model<FileDocument>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Validate that a user has access to perform a specific action on a file.
   *
   * This is the main authorization gate for shared file access.
   * File owners bypass this check — they have unrestricted access.
   *
   * @returns The validated share record (useful for tracking download counts, etc.)
   * @throws AccessDeniedException if any validation fails
   * @throws ShareExpiredException if the share has expired
   */
  async validateAccess(
    fileId: string,
    userId: string,
    action: ShareAction,
    deviceCertificateId?: string,
  ): Promise<FileAccessDocument> {
    // ─── Key Resolution ────────────────────────────────
    // fileId and sharedWithUserId are ObjectId fields. Callers legitimately pass
    // a file UUID (that's the public identifier on /files/:id), which Mongoose
    // cannot cast — it would throw a CastError instead of denying access.
    const fileObjectId = await this.resolveFileObjectId(fileId);
    if (!fileObjectId) {
      this.logger.warn(
        `Access denied: could not resolve file=${fileId} to a stored file`,
      );
      await this.logAccessDenied(fileId, userId, action, 'File not found');
      throw new AccessDeniedException();
    }

    const userObjectId = this.toObjectId(userId);
    if (!userObjectId) {
      this.logger.warn(`Access denied: malformed user identifier=${userId}`);
      await this.logAccessDenied(
        fileId,
        userId,
        action,
        'Malformed user identifier',
      );
      throw new AccessDeniedException();
    }

    // Find the active share record
    const share = await this.fileAccessModel.findOne({
      fileId: fileObjectId,
      sharedWithUserId: userObjectId,
      status: ShareStatus.ACTIVE,
    });

    if (!share) {
      this.logger.warn(
        `Access denied: No active share found for file=${fileId}, user=${userId}`,
      );
      await this.logAccessDenied(
        fileId,
        userId,
        action,
        'No active share record',
      );
      throw new AccessDeniedException();
    }

    // ─── Lazy Expiration Check ─────────────────────────
    if (new Date() > share.expiresAt) {
      share.status = ShareStatus.EXPIRED;
      await share.save();

      this.logger.log(
        `Share expired lazily: shareId=${share._id}, file=${fileId}, user=${userId}`,
      );

      await this.auditService.log({
        action: AuditAction.FILE_SHARE,
        resource: 'file_access',
        resourceId: share._id.toString(),
        userId,
        metadata: {
          event: 'share_expired',
          fileId,
          expiredAt: share.expiresAt.toISOString(),
        },
        status: 'success',
      });

      throw new ShareExpiredException();
    }

    // ─── Permission Level Check ────────────────────────
    if (!hasPermissionForAction(share.permission, action)) {
      this.logger.warn(
        `Permission denied: user=${userId} has ${share.permission}, needs ${action} on file=${fileId}`,
      );
      await this.logAccessDenied(
        fileId,
        userId,
        action,
        `Insufficient permission: has ${share.permission}`,
      );
      throw new AccessDeniedException();
    }

    // ─── Enterprise Controls ───────────────────────────

    // Download limit check
    if (
      action === ShareAction.DOWNLOAD &&
      share.maxDownloads !== null &&
      share.downloadCount >= share.maxDownloads
    ) {
      this.logger.warn(
        `Download limit reached: shareId=${share._id}, count=${share.downloadCount}/${share.maxDownloads}`,
      );
      await this.logAccessDenied(
        fileId,
        userId,
        action,
        'Download limit reached',
      );
      throw new AccessDeniedException('Download limit reached');
    }

    // Device certificate restriction
    if (share.allowedDeviceCertificateId) {
      if (
        !deviceCertificateId ||
        deviceCertificateId !== share.allowedDeviceCertificateId
      ) {
        this.logger.warn(
          `Device restriction: shareId=${share._id}, expected=${share.allowedDeviceCertificateId}, got=${deviceCertificateId}`,
        );
        await this.logAccessDenied(
          fileId,
          userId,
          action,
          'Device certificate mismatch',
        );
        throw new AccessDeniedException('Device not authorized for this share');
      }
    }

    return share;
  }

  /**
   * Increment the download counter for a share.
   * Called after a successful download.
   */
  async recordDownload(shareId: string): Promise<void> {
    const share = await this.fileAccessModel.findById(shareId);
    if (!share) return;

    share.downloadCount += 1;

    // One-time access: revoke after first access
    if (share.oneTimeAccess) {
      share.status = ShareStatus.REVOKED;
      this.logger.log(
        `One-time access share revoked after download: shareId=${shareId}`,
      );
    }

    // Download limit reached: mark as expired
    if (
      share.maxDownloads !== null &&
      share.downloadCount >= share.maxDownloads
    ) {
      share.status = ShareStatus.EXPIRED;
      this.logger.log(
        `Download limit reached, share expired: shareId=${shareId}`,
      );
    }

    await share.save();
  }

  /**
   * Check if a share is still valid without throwing.
   * Useful for conditional UI logic.
   */
  async isShareValid(shareId: string): Promise<boolean> {
    const share = await this.fileAccessModel.findById(shareId);
    if (!share || share.status !== ShareStatus.ACTIVE) return false;

    // Lazy expiration
    if (new Date() > share.expiresAt) {
      share.status = ShareStatus.EXPIRED;
      await share.save();
      return false;
    }

    return true;
  }

  /**
   * Expire all shares that have passed their expiresAt timestamp.
   * Designed for future scheduled job support.
   */
  async expireOverdueShares(): Promise<number> {
    const result = await this.fileAccessModel.updateMany(
      {
        status: ShareStatus.ACTIVE,
        expiresAt: { $lt: new Date() },
      },
      {
        $set: { status: ShareStatus.EXPIRED },
      },
    );

    const count = result.modifiedCount;
    if (count > 0) {
      this.logger.log(`Batch expired ${count} overdue shares`);
    }

    return count;
  }

  /**
   * Resolve a file identifier to the ObjectId stored on `file_access.fileId`.
   *
   * Accepts either a Mongo `_id` (used directly, no extra query) or a file
   * `uuid`, which is resolved through the files collection first. Uses the same
   * dual-key `uuid` → `_id` lookup as the other resolvers in the codebase.
   */
  private async resolveFileObjectId(
    fileId: string,
  ): Promise<Types.ObjectId | null> {
    const asObjectId = this.toObjectId(fileId);
    if (asObjectId) {
      return asObjectId;
    }

    let file = await this.fileModel.findOne({ uuid: fileId });
    if (!file) {
      try {
        file = await this.fileModel.findById(fileId);
      } catch {
        // Invalid ObjectId format — treated as not found
      }
    }

    return file ? file._id : null;
  }

  /**
   * Convert a 24-character hex string to an ObjectId, or null if it isn't one.
   *
   * Deliberately stricter than `Types.ObjectId.isValid`, which also accepts any
   * 12-character string and would silently cast unrelated input.
   */
  private toObjectId(value: string): Types.ObjectId | null {
    return /^[0-9a-fA-F]{24}$/.test(value) ? new Types.ObjectId(value) : null;
  }

  /**
   * Log an access denied event for audit purposes.
   */
  private async logAccessDenied(
    fileId: string,
    userId: string,
    action: ShareAction,
    reason: string,
  ): Promise<void> {
    await this.auditService.log({
      action: AuditAction.FILE_SHARE,
      resource: 'file_access',
      userId,
      metadata: {
        event: 'access_denied',
        fileId,
        requestedAction: action,
        reason,
      },
      status: 'failure',
    });
  }
}
