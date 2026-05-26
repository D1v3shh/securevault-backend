import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type FileDocument = FileEntity & Document;

/**
 * File metadata schema.
 * Stores metadata about uploaded files — the actual file data is in encrypted storage.
 */
@Schema({
  timestamps: true,
  collection: 'files',
})
export class FileEntity {
  @Prop({ type: String, default: uuidv4, unique: true, index: true })
  uuid: string;

  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  storagePath: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  size: number;

  /** Checksum of the original (unencrypted) file */
  @Prop({ required: true })
  checksum: string;

  // ─── Encryption Metadata ─────────────────────────
  /** ID of the Data Encryption Key used */
  @Prop({ required: true })
  encryptionKeyId: string;

  /** Encrypted DEK (hex-encoded) */
  @Prop({ required: true })
  encryptedDek: string;

  /** Initialization vector used for file encryption (hex-encoded) */
  @Prop({ required: true })
  encryptionIv: string;

  /** Auth tag from AES-GCM encryption (hex-encoded) */
  @Prop({ required: true })
  encryptionAuthTag: string;

  // ─── Ownership & Access ──────────────────────────
  @Prop({ type: Types.ObjectId, ref: 'UserEntity', required: true, index: true })
  uploadedBy: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['private', 'internal', 'department', 'public'],
    default: 'private',
  })
  accessLevel: string;

  @Prop({ type: String, default: null })
  department: string | null;

  @Prop({ type: String, default: null })
  description: string | null;

  // ─── Soft Delete ─────────────────────────────────
  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: String, default: null })
  deletedBy: string | null;
}

export const FileSchema = SchemaFactory.createForClass(FileEntity);

// Indexes for efficient querying
FileSchema.index({ uploadedBy: 1, isDeleted: 1, createdAt: -1 });
FileSchema.index({ accessLevel: 1, isDeleted: 1 });
FileSchema.index({ mimeType: 1 });
