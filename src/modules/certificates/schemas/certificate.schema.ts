import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type CertificateDocument = CertificateEntity & Document;

/**
 * Certificate status tracking.
 */
export enum CertificateStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  PENDING = 'pending',
}

/**
 * X.509 certificate metadata stored in MongoDB.
 * The actual certificate PEM is stored alongside metadata
 * for verification and chain validation.
 */
@Schema({
  collection: 'certificates',
  timestamps: true,
  versionKey: false,
})
export class CertificateEntity {
  @Prop({ type: String, default: () => uuidv4(), unique: true, index: true })
  uuid: string;

  @Prop({ required: true, unique: true, index: true })
  serialNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'UserEntity', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  employeeId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true })
  deviceFingerprint: string;

  @Prop({ required: true })
  fingerprint: string; // SHA-256 fingerprint of the certificate

  @Prop({ required: true })
  issuer: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true, type: Date })
  validFrom: Date;

  @Prop({ required: true, type: Date })
  validTo: Date;

  @Prop({ type: String, default: null })
  certificatePem: string | null; // Signed certificate PEM

  @Prop({ type: String, default: null })
  csrPem: string | null; // Original CSR

  @Prop({ type: String, enum: ['RSA', 'ECC'], default: 'RSA' })
  keyType: string;

  @Prop({ type: Number, default: 4096 })
  keySize: number;

  @Prop({ type: String, default: 'SHA256' })
  signatureAlgorithm: string;

  @Prop({
    type: String,
    enum: CertificateStatus,
    default: CertificateStatus.ACTIVE,
    index: true,
  })
  status: CertificateStatus;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  @Prop({ type: String, default: null })
  revokedBy: string | null;

  @Prop({ type: String, default: null })
  revocationReason: string | null;

  @Prop({ type: Number, default: 0 })
  renewalCount: number;

  @Prop({ type: String, default: null })
  previousSerial: string | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const CertificateSchema = SchemaFactory.createForClass(CertificateEntity);

// Indexes
CertificateSchema.index({ userId: 1, status: 1 });
CertificateSchema.index({ serialNumber: 1, status: 1 });
CertificateSchema.index({ deviceId: 1, status: 1 });
CertificateSchema.index({ fingerprint: 1 });
CertificateSchema.index({ validTo: 1 }); // For expiration monitoring
CertificateSchema.index({ createdAt: -1 });
