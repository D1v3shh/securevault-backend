import { Injectable, Inject, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import * as StorageProviderNs from './interfaces/storage-provider.interface';
import { STORAGE_PROVIDER } from './interfaces/storage-provider.interface';
import type { StorageResult, StorageMetadata } from './interfaces/storage-provider.interface';

/**
 * Storage service facade.
 * Delegates to the configured storage provider (local, S3, etc.).
 * Business logic should depend on this service, not the provider directly.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly provider: StorageProviderNs.IStorageProvider,
  ) {}

  async upload(filePath: string, data: Buffer): Promise<StorageResult> {
    return this.provider.upload(filePath, data);
  }

  async download(filePath: string): Promise<Buffer> {
    return this.provider.download(filePath);
  }

  async downloadStream(filePath: string): Promise<Readable> {
    return this.provider.downloadStream(filePath);
  }

  async delete(filePath: string): Promise<void> {
    return this.provider.delete(filePath);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.provider.exists(filePath);
  }

  async getMetadata(filePath: string): Promise<StorageMetadata> {
    return this.provider.getMetadata(filePath);
  }
}
