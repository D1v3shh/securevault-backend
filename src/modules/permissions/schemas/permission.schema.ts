import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Role } from '../constants/roles.enum';
import { Permission } from '../constants/permissions.enum';

export type PermissionDocument = PermissionEntity & Document;

/**
 * Permission schema for storing granular permissions.
 * Supports future custom permission assignments per role or per user.
 */
@Schema({
  collection: 'permissions',
  timestamps: true,
  versionKey: false,
})
export class PermissionEntity {
  @Prop({ required: true, type: String, enum: Role, index: true })
  role: Role;

  @Prop({ required: true, type: String, index: true })
  resource: string;

  @Prop({ required: true, type: String })
  action: string;

  @Prop({ type: String, enum: Permission, index: true })
  permission: Permission;

  @Prop({ default: true })
  allowed: boolean;

  @Prop({ type: String })
  description: string;
}

export const PermissionSchema = SchemaFactory.createForClass(PermissionEntity);

// Compound index for efficient permission lookups
PermissionSchema.index({ role: 1, resource: 1, action: 1 }, { unique: true });
