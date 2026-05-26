import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PermissionEntity, PermissionDocument } from './schemas/permission.schema';
import { Role } from './constants/roles.enum';
import { Permission, ROLE_PERMISSIONS } from './constants/permissions.enum';

/**
 * Service for managing permissions and role-based access control.
 * Provides methods to check permissions against the RBAC matrix.
 */
@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectModel(PermissionEntity.name)
    private readonly permissionModel: Model<PermissionDocument>,
  ) {}

  /**
   * Check if a role has a specific permission.
   * First checks the in-memory ROLE_PERMISSIONS constant,
   * then falls back to database for custom overrides.
   */
  async hasPermission(role: Role, permission: Permission): Promise<boolean> {
    // Check static role-permission map first (fast path)
    const rolePerms = ROLE_PERMISSIONS[role];
    if (rolePerms && rolePerms.includes(permission)) {
      return true;
    }

    // Check database for custom permission overrides
    const dbPermission = await this.permissionModel.findOne({
      role,
      permission,
      allowed: true,
    });

    return !!dbPermission;
  }

  /**
   * Get all permissions for a given role.
   */
  getPermissionsForRole(role: Role): Permission[] {
    return ROLE_PERMISSIONS[role] || [];
  }

  /**
   * Check if a role has any of the specified permissions.
   */
  hasAnyPermission(role: Role, permissions: Permission[]): boolean {
    const rolePerms = ROLE_PERMISSIONS[role] || [];
    return permissions.some((p) => rolePerms.includes(p));
  }

  /**
   * Check if a role has all of the specified permissions.
   */
  hasAllPermissions(role: Role, permissions: Permission[]): boolean {
    const rolePerms = ROLE_PERMISSIONS[role] || [];
    return permissions.every((p) => rolePerms.includes(p));
  }
}
