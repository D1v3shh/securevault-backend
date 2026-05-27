import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type DeviceDocument = DeviceEntity & Document;

/**
 * Device trust status enum.
 * Tracks the lifecycle of a device in the trust model.
 */
export enum DeviceStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REVOKED = 'revoked',
  BLOCKED = 'blocked',
}

/**
 * Device entity schema for MongoDB.
 * Stores device fingerprint, hardware metadata, and trust status.
 * Each device is bound to one employee and one certificate.
 */
@Schema({
  collection: 'devices',
  timestamps: true,
  versionKey: false,
})
export class DeviceEntity {
  @Prop({ type: String, default: () => uuidv4(), unique: true, index: true })
  deviceId: string;

  @Prop({ type: Types.ObjectId, ref: 'UserEntity', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  employeeId: string;

  @Prop({ required: true, unique: true, index: true })
  fingerprint: string;

  @Prop({ type: String, default: null })
  hostname: string | null;

  @Prop({ type: String, default: null })
  platform: string | null;

  @Prop({ type: String, default: null })
  arch: string | null;

  @Prop({ type: String, default: null })
  osVersion: string | null;

  @Prop({ type: String, default: null })
  macAddress: string | null;

  @Prop({ type: String, default: null })
  serialNumber: string | null;

  @Prop({
    type: String,
    enum: DeviceStatus,
    default: DeviceStatus.PENDING,
    index: true,
  })
  status: DeviceStatus;

  @Prop({ type: String, default: null })
  certificateSerial: string | null;

  @Prop({ type: Date, default: null })
  lastSeenAt: Date | null;

  @Prop({ type: String, default: null })
  lastSeenIp: string | null;

  @Prop({ type: String, default: null })
  enrolledBy: string | null;

  @Prop({ type: Date, default: null })
  approvedAt: Date | null;

  @Prop({ type: String, default: null })
  approvedBy: string | null;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  @Prop({ type: String, default: null })
  revokedBy: string | null;

  @Prop({ type: String, default: null })
  revokeReason: string | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const DeviceSchema = SchemaFactory.createForClass(DeviceEntity);

// Compound indexes for efficient queries
DeviceSchema.index({ userId: 1, status: 1 });
DeviceSchema.index({ fingerprint: 1, status: 1 });
DeviceSchema.index({ employeeId: 1, status: 1 });
DeviceSchema.index({ certificateSerial: 1 });
DeviceSchema.index({ createdAt: -1 });
