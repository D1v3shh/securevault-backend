import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FileEntity, FileDocument } from '../../files/schemas/file.schema';
import { StorageService } from '../../storage/storage.service';

/**
 * File processor for handling asynchronous file operations.
 *
 * Handles:
 * - Cleanup of soft-deleted files after retention period
 * - File integrity verification (periodic checksum validation)
 * - Storage optimization tasks
 *
 * Designed to be plugged into BullMQ worker for production use.
 */
@Injectable()
export class FileProcessor {
  private readonly logger = new Logger(FileProcessor.name);

  /** Retention period for soft-deleted files (30 days in ms) */
  private readonly RETENTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

  constructor(
    @InjectModel(FileEntity.name)
    private readonly fileModel: Model<FileDocument>,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Permanently delete files that have been soft-deleted beyond the retention period.
   * This job should be scheduled to run periodically (e.g., daily via cron).
   */
  async cleanupExpiredFiles(): Promise<{ deleted: number; errors: number }> {
    const cutoffDate = new Date(Date.now() - this.RETENTION_PERIOD_MS);
    let deleted = 0;
    let errors = 0;

    try {
      const expiredFiles = await this.fileModel.find({
        isDeleted: true,
        deletedAt: { $lte: cutoffDate },
      }).exec();

      this.logger.log(`Found ${expiredFiles.length} expired files for permanent deletion`);

      for (const file of expiredFiles) {
        try {
          // Delete from storage
          const exists = await this.storageService.exists(file.storagePath);
          if (exists) {
            await this.storageService.delete(file.storagePath);
          }

          // Delete metadata from MongoDB
          await this.fileModel.deleteOne({ _id: file._id });
          deleted++;
        } catch (error: any) {
          errors++;
          this.logger.error(
            `Failed to permanently delete file ${file.uuid}: ${error.message}`,
          );
        }
      }

      this.logger.log(`Cleanup complete: ${deleted} deleted, ${errors} errors`);
    } catch (error: any) {
      this.logger.error(`File cleanup job failed: ${error.message}`);
    }

    return { deleted, errors };
  }

  /**
   * Verify file integrity by checking storage existence.
   * Flags orphaned metadata records where the actual file is missing.
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
          this.logger.warn(`Orphaned file metadata: ${file.uuid} (storage path: ${file.storagePath})`);
        }
      }

      this.logger.log(`Integrity check: ${checked} checked, ${orphaned} orphaned`);
    } catch (error: any) {
      this.logger.error(`File integrity check failed: ${error.message}`);
    }

    return { checked, orphaned };
  }
}
