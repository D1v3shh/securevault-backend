import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SharePermission } from '../enums/share-permission.enum';
import { ShareStatus } from '../enums/share-status.enum';

export type FileAccessDocument = FileAccessEntity & Document;

/**
 * File access / share record.
 * Tracks who has been granted access to a file, with what permissions,
 * and under what enterprise controls.
 */
@Schema({
  timestamps: true,
  collection: 'file_access',
})
export class FileAccessEntity {
  // ─── Core Share Fields ──────────────────────────────
  @Prop({
    type: Types.ObjectId,
    ref: 'FileEntity',
    required: true,
    index: true,
  })
  fileId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'UserEntity',
    required: true,
    index: true,
  })
  ownerId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'UserEntity',
    required: true,
    index: true,
  })
  sharedWithUserId: Types.ObjectId;

  @Prop({
    type: String,
    enum: SharePermission,
    required: true,
    default: SharePermission.VIEW,
  })
  permission: SharePermission;

  @Prop({
    type: String,
    enum: ShareStatus,
    required: true,
    default: ShareStatus.ACTIVE,
  })
  status: ShareStatus;

  @Prop({ type: Date, required: true })
  sharedAt: Date;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  // ─── Enterprise Controls (disabled by default) ──────
  @Prop({ type: Number, default: null })
  maxDownloads: number | null;

  @Prop({ type: Number, default: 0 })
  downloadCount: number;

  @Prop({ type: Boolean, default: false })
  oneTimeAccess: boolean;

  @Prop({ type: Boolean, default: false })
  watermarkEnabled: boolean;

  @Prop({ type: String, default: null })
  allowedDeviceCertificateId: string | null;
}

export const FileAccessSchema = SchemaFactory.createForClass(FileAccessEntity);

// ─── Indexes ─────────────────────────────────────────
// Prevent duplicate active shares for the same file + user
FileAccessSchema.index(
  { fileId: 1, sharedWithUserId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: ShareStatus.ACTIVE },
  },
);

// Efficient queries for "shared with me" and "shared by me"
FileAccessSchema.index({ sharedWithUserId: 1, status: 1, createdAt: -1 });
FileAccessSchema.index({ ownerId: 1, status: 1, createdAt: -1 });

// Expiration lookups
FileAccessSchema.index({ status: 1, expiresAt: 1 });

// File-level access lookups
FileAccessSchema.index({ fileId: 1, status: 1 });
