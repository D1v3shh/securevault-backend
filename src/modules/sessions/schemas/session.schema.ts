import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type SessionDocument = SessionEntity & Document;

/**
 * Session entity for tracking active authenticated sessions.
 * Each session is tied to a user, device, and certificate.
 */
@Schema({
  collection: 'sessions',
  timestamps: true,
  versionKey: false,
})
export class SessionEntity {
  @Prop({ type: String, default: () => uuidv4(), unique: true, index: true })
  sessionId: string;

  @Prop({ type: Types.ObjectId, ref: 'UserEntity', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  deviceId: string;

  @Prop({ type: String, default: null })
  certificateSerial: string | null;

  @Prop({ type: String, default: null })
  ipAddress: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Date, default: () => new Date() })
  startedAt: Date;

  @Prop({ type: Date, default: null })
  endedAt: Date | null;

  @Prop({ type: Date, default: () => new Date() })
  lastActivityAt: Date;

  @Prop({ type: String, enum: ['certificate', 'password'], default: 'certificate' })
  authMethod: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const SessionSchema = SchemaFactory.createForClass(SessionEntity);

// Indexes
SessionSchema.index({ userId: 1, isActive: 1 });
SessionSchema.index({ deviceId: 1, isActive: 1 });
SessionSchema.index({ sessionId: 1 });
SessionSchema.index({ lastActivityAt: -1 });
// TTL — auto-cleanup inactive sessions after 30 days
SessionSchema.index({ endedAt: 1 }, { expireAfterSeconds: 2592000, partialFilterExpression: { endedAt: { $ne: null } } });
