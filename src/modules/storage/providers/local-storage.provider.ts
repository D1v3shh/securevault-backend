import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { IStorageProvider, StorageResult, StorageMetadata } from '../interfaces/storage-provider.interface';
import { CryptoUtil } from '../../../shared/utils/crypto.util';

/**
 * Local filesystem storage provider.
 * Stores encrypted files on the local disk.
 * Production replacement: S3, MinIO, Azure Blob, GCS.
 */
@Injectable()
export class LocalStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly basePath: string;

  constructor(private readonly configService: ConfigService) {
    this.basePath = path.resolve(
      this.configService.get<string>('storage.localPath', './storage/uploads'),
    );
    this.ensureDirectoryExists(this.basePath);
  }

  async upload(filePath: string, data: Buffer): Promise<StorageResult> {
    const fullPath = this.getFullPath(filePath);
    const dir = path.dirname(fullPath);

    await this.ensureDirectoryExists(dir);
    await fs.writeFile(fullPath, data);

    const checksum = CryptoUtil.sha256(data);
    this.logger.debug(`File stored: ${filePath} (${data.length} bytes)`);

    return { path: filePath, size: data.length, checksum };
  }

  async download(filePath: string): Promise<Buffer> {
    const fullPath = this.getFullPath(filePath);
    return fs.readFile(fullPath);
  }

  async downloadStream(filePath: string): Promise<Readable> {
    const fullPath = this.getFullPath(filePath);
    return fsSync.createReadStream(fullPath);
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = this.getFullPath(filePath);
    try {
      await fs.unlink(fullPath);
      this.logger.debug(`File deleted: ${filePath}`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const fullPath = this.getFullPath(filePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(filePath: string): Promise<StorageMetadata> {
    const fullPath = this.getFullPath(filePath);
    const stats = await fs.stat(fullPath);
    return { size: stats.size, lastModified: stats.mtime };
  }

  private getFullPath(filePath: string): string {
    const resolved = path.resolve(this.basePath, filePath);
    if (!resolved.startsWith(this.basePath)) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }

  private async ensureDirectoryExists(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch { /* already exists */ }
  }
}
