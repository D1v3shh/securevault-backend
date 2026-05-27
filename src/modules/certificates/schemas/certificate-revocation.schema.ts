import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type CertificateRevocationDocument = CertificateRevocationEntity & Document;

/**
 * Standard CRL revocation reasons per RFC 5280.
 */
export enum RevocationReason {
  UNSPECIFIED = 'unspecified',
  KEY_COMPROMISE = 'key_compromise',
  CA_COMPROMISE = 'ca_compromise',
  AFFILIATION_CHANGED = 'affiliation_changed',
  SUPERSEDED = 'superseded',
  CESSATION_OF_OPERATION = 'cessation_of_operation',
  PRIVILEGE_WITHDRAWN = 'privilege_withdrawn',
}

/**
 * Certificate revocation record.
 * Immutable by design — revocations should never be reversed.
 */
@Schema({
  collection: 'certificate_revocations',
  timestamps: true,
  versionKey: false,
})
export class CertificateRevocationEntity {
  @Prop({ type: String, default: () => uuidv4(), unique: true, index: true })
  uuid: string;

  @Prop({ required: true, unique: true, index: true })
  certificateSerial: string;

  @Prop({ type: Types.ObjectId, ref: 'UserEntity', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, default: null })
  deviceId: string | null;

  @Prop({
    type: String,
    enum: RevocationReason,
    default: RevocationReason.UNSPECIFIED,
  })
  reason: RevocationReason;

  @Prop({ required: true })
  revokedBy: string;

  @Prop({ type: Date, default: () => new Date() })
  revokedAt: Date;

  @Prop({ type: String, default: null })
  ipAddress: string | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const CertificateRevocationSchema = SchemaFactory.createForClass(CertificateRevocationEntity);

// Index for fast revocation checking
CertificateRevocationSchema.index({ certificateSerial: 1 });
CertificateRevocationSchema.index({ userId: 1 });
CertificateRevocationSchema.index({ revokedAt: -1 });
