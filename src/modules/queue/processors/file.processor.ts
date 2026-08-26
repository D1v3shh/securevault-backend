import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FileEntity, FileDocument } from '../../files/schemas/file.schema';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../audit/interfaces/audit.interface';
import { APP_CONSTANTS } from '../../../shared/constants/app.constants';

export interface CleanupOptions {
  /**
   * When true, report what *would* be purged and touch nothing.
   * Deliberately required: this is the only irreversible delete path in the
   * codebase, so the caller has to state intent explicitly.
   */
  dryRun: boolean;

  /** Hard cap on files handled in one run. Defaults to 100. */
  limit?: number;

  /** User id recorded as the actor in the audit trail. */
  performedBy?: string;
}

export interface CleanupResult {
  dryRun: boolean;
  /** Files matching the retention cutoff, up to `limit`. */
  scanned: number;
  /** Files actually purged (always 0 for a dry run). */
  deleted: number;
  errors: number;
  /** UUIDs of the files purged, or of the candidates on a dry run. */
  uuids: string[];
}

/**
 * File processor for handling asynchronous file operations.
 *
 * Handles:
 * - Cleanup of soft-deleted files after retention period
 * - Detection of orphaned metadata (file row present, blob missing)
 *
 * Designed to be plugged into BullMQ worker for production use. Nothing
 * schedules these today — `cleanupExpiredFiles` is driven by
 * `scripts/cleanup-expired-files.ts`.
 */
@Injectable()
export class FileProcessor {
  private readonly logger = new Logger(FileProcessor.name);

  /** Retention period for soft-deleted files (30 days in ms) */
  private readonly RETENTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

  /** Default cap on files purged per run, so a run has a bounded blast radius. */
  private readonly DEFAULT_LIMIT = 100;

  constructor(
    @InjectModel(FileEntity.name)
    private readonly fileModel: Model<FileDocument>,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Permanently delete files soft-deleted beyond the retention period.
   *
   * This is irreversible in the strongest sense: it removes the ciphertext AND
   * the metadata row holding `encryptedDek` / `encryptionIv` /
   * `encryptionAuthTag`, so once the row is gone the blob cannot be decrypted
   * even if it is recovered from a backup. Every purge therefore writes an audit
   * entry before the delete, the run is capped by `limit`, and `dryRun` lets the
   * caller inspect the candidate set first.
   */
  async cleanupExpiredFiles(options: CleanupOptions): Promise<CleanupResult> {
    const { dryRun, limit = this.DEFAULT_LIMIT, performedBy } = options;
    const cutoffDate = new Date(Date.now() - this.RETENTION_PERIOD_MS);
    const uuids: string[] = [];
    let deleted = 0;
    let errors = 0;
    let scanned = 0;

    try {
      const expiredFiles = await this.fileModel
        .find({
          isDeleted: true,
          deletedAt: { $lte: cutoffDate },
        })
        .limit(limit)
        .exec();

      scanned = expiredFiles.length;
      this.logger.log(
        `${dryRun ? '[dry run] ' : ''}Found ${scanned} file(s) soft-deleted ` +
          `before ${cutoffDate.toISOString()} (limit ${limit})`,
      );

      for (const file of expiredFiles) {
        if (dryRun) {
          uuids.push(file.uuid);
          this.logger.log(
            `[dry run] would purge ${file.uuid} (${file.originalName}, ` +
              `deletedAt ${file.deletedAt?.toISOString()})`,
          );
          continue;
        }

        try {
          // Audit before deleting: afterwards there is no row left to describe.
          await this.auditService.log({
            action: AuditAction.FILE_DELETE,
            resource: 'file',
            resourceId: file.uuid,
            userId: performedBy ?? APP_CONSTANTS.SYSTEM_USER_ID,
            metadata: {
              event: 'permanent_delete',
              fileName: file.originalName,
              storagePath: file.storagePath,
              size: file.size,
              softDeletedAt: file.deletedAt?.toISOString() ?? null,
              softDeletedBy: file.deletedBy ?? null,
              retentionDays: this.RETENTION_PERIOD_MS / 86400000,
            },
            status: 'success',
          });

          // Delete from storage
          const exists = await this.storageService.exists(file.storagePath);
          if (exists) {
            await this.storageService.delete(file.storagePath);
          }

          // Delete metadata from MongoDB
          await this.fileModel.deleteOne({ _id: file._id });
          deleted++;
          uuids.push(file.uuid);
        } catch (error: any) {
          errors++;
          this.logger.error(
            `Failed to permanently delete file ${file.uuid}: ${error.message}`,
          );
        }
      }

      this.logger.log(
        `${dryRun ? '[dry run] ' : ''}Cleanup complete: ${scanned} scanned, ` +
          `${deleted} deleted, ${errors} errors`,
      );
    } catch (error: any) {
      this.logger.error(`File cleanup job failed: ${error.message}`);
    }

    return { dryRun, scanned, deleted, errors, uuids };
  }

  /**
   * Check that every non-deleted file row still has its blob on disk.
   *
   * Note: this checks *presence* only — it does not recompute checksums or
   * verify GCM auth tags. Capped at 100 rows with no cursor, so it samples
   * rather than sweeps.
   */
  async verifyFileIntegrity(): Promise<{ checked: number; orphaned: number }> {
    let checked = 0;
    let orphaned = 0;

    try {
      // Check a batch of non-deleted files
      const files = await this.fileModel
        .find({ isDeleted: false })
        .select('uuid storagePath')
        .limit(100)
        .exec();

      for (const file of files) {
        checked++;
        const exists = await this.storageService.exists(file.storagePath);
        if (!exists) {
          orphaned++;
          this.logger.warn(
            `Orphaned file metadata: ${file.uuid} (storage path: ${file.storagePath})`,
          );
        }
      }

      this.logger.log(
        `Integrity check: ${checked} checked, ${orphaned} orphaned`,
      );
    } catch (error: any) {
      this.logger.error(`File integrity check failed: ${error.message}`);
    }

    return { checked, orphaned };
  }
}
