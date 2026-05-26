import * as path from 'path';
import { APP_CONSTANTS } from '../constants/app.constants';

/**
 * File utility functions for validation and path handling.
 */
export class FileUtil {
  /**
   * Validate that a MIME type is in the allowed list.
   */
  static isAllowedMimeType(mimeType: string): boolean {
    return APP_CONSTANTS.ALLOWED_MIME_TYPES.includes(mimeType as any);
  }

  /**
   * Sanitize a filename by removing dangerous characters.
   */
  static sanitizeFilename(filename: string): string {
    // Remove path traversal attempts
    const basename = path.basename(filename);
    // Replace non-alphanumeric chars except dots, hyphens, underscores
    return basename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  }

  /**
   * Get file extension from filename.
   */
  static getExtension(filename: string): string {
    return path.extname(filename).toLowerCase();
  }

  /**
   * Generate a unique storage filename using UUID.
   */
  static generateStorageFilename(originalFilename: string): string {
    const ext = FileUtil.getExtension(originalFilename);
    const uuid = require('uuid').v4();
    return `${uuid}${ext}`;
  }

  /**
   * Generate a storage path with date-based directory structure.
   * Format: YYYY/MM/DD/uuid.ext
   */
  static generateStoragePath(uuid: string, ext: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}/${uuid}${ext}`;
  }

  /**
   * Convert bytes to human-readable size string.
   */
  static formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}
