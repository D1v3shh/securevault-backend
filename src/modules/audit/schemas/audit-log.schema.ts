import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type AuditLogDocument = AuditLogEntity & Document;

/**
 * Audit log schema for recording all security-relevant actions.
 * Immutable by design — no update operations should be performed on audit logs.
 */
@Schema({
  collection: 'audit_logs',
  timestamps: false,
  versionKey: false,
})
export class AuditLogEntity {
  @Prop({ type: String, default: () => uuidv4(), index: true })
  uuid: string;

  @Prop({ required: true, index: true })
  action: string;

  @Prop({ required: true, index: true })
  resource: string;

  @Prop({ type: String, default: null })
  resourceId: string | null;

  @Prop({ type: Types.ObjectId, ref: 'UserEntity', default: null, index: true })
  userId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  userEmail: string | null;

  @Prop({ type: String, default: null })
  userRole: string | null;

  @Prop({ type: String, default: null })
  ipAddress: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ type: String, enum: ['success', 'failure', 'error'], default: 'success' })
  status: string;

  @Prop({ type: Date, default: () => new Date(), index: true })
  timestamp: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLogEntity);

// Indexes for efficient querying
AuditLogSchema.index({ action: 1, timestamp: -1 });
AuditLogSchema.index({ userId: 1, timestamp: -1 });
AuditLogSchema.index({ resource: 1, resourceId: 1 });
// TTL index — auto-delete audit logs after 2 years (configurable)
// AuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 63072000 });
