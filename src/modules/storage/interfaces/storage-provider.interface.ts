import { Readable } from 'stream';

/**
 * Storage provider interface.
 * Abstracts file storage operations. Implementations:
 * - LocalStorageProvider (current)
 * - S3StorageProvider (future)
 * - MinIOStorageProvider (future)
 * - AzureBlobStorageProvider (future)
 * - GCSStorageProvider (future)
 */
export interface IStorageProvider {
  upload(filePath: string, data: Buffer): Promise<StorageResult>;
  download(filePath: string): Promise<Buffer>;
  downloadStream(filePath: string): Promise<Readable>;
  delete(filePath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  getMetadata(filePath: string): Promise<StorageMetadata>;
}

export interface StorageResult {
  path: string;
  size: number;
  checksum: string;
}

export interface StorageMetadata {
  size: number;
  lastModified: Date;
  contentType?: string;
}

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';
