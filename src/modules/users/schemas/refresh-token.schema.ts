import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RefreshTokenDocument = RefreshTokenEntity & Document;

/**
 * Refresh token schema.
 * Tracks active refresh tokens for session management and token rotation.
 */
@Schema({
  collection: 'refresh_tokens',
  timestamps: true,
  versionKey: false,
})
export class RefreshTokenEntity {
  @Prop({ required: true, unique: true, index: true })
  token: string;

  @Prop({ type: Types.ObjectId, ref: 'UserEntity', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, default: null })
  deviceInfo: string | null;

  @Prop({ type: String, default: null })
  ipAddress: string | null;

  @Prop({ default: false })
  isRevoked: boolean;

  @Prop({ required: true, type: Date })
  expiresAt: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshTokenEntity);

// TTL index — MongoDB automatically deletes expired tokens
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Query index for finding user's active tokens
RefreshTokenSchema.index({ userId: 1, isRevoked: 1 });
