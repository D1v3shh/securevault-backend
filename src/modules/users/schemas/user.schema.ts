import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Role } from '../../permissions/constants/roles.enum';
import { v4 as uuidv4 } from 'uuid';

export type UserDocument = UserEntity & Document;

/**
 * User entity schema for MongoDB.
 * Stores employee/admin account information.
 * Supports soft-delete, account lockout, forced password reset.
 */
@Schema({
  collection: 'users',
  timestamps: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
      delete ret.passwordHash;
      delete ret.temporaryPassword;
      return ret;
    },
  },
})
export class UserEntity {
  @Prop({ type: String, default: () => uuidv4(), unique: true, index: true })
  uuid: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({ type: String, enum: Role, default: Role.EMPLOYEE, index: true })
  role: Role;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: true })
  isFirstLogin: boolean;

  @Prop({ default: true })
  mustChangePassword: boolean;

  @Prop({ type: String, default: null })
  temporaryPassword: string | null;

  @Prop({ type: Date, default: null })
  passwordChangedAt: Date | null;

  @Prop({ default: 0 })
  failedLoginAttempts: number;

  @Prop({ type: Date, default: null })
  lockoutUntil: Date | null;

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null;

  @Prop({ type: String, default: null })
  lastLoginIp: string | null;

  @Prop({ type: String, default: null })
  department: string | null;

  @Prop({ type: String, default: null })
  jobTitle: string | null;

  @Prop({ type: String, default: null })
  createdBy: string | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: String, default: null })
  deletedBy: string | null;
}

export const UserSchema = SchemaFactory.createForClass(UserEntity);

// Compound indexes for common queries
UserSchema.index({ email: 1, isActive: 1 });
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ deletedAt: 1 });
UserSchema.index({ createdAt: -1 });

// Virtual for full name
UserSchema.virtual('fullName').get(function (this: UserDocument) {
  return `${this.firstName} ${this.lastName}`;
});
