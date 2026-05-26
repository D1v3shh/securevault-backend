/**
 * Granular permissions for future fine-grained access control.
 * Currently used as documentation; the RBAC system can evolve from role-based to permission-based.
 */
export enum Permission {
  // User Management
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  USER_ACTIVATE = 'user:activate',
  USER_DEACTIVATE = 'user:deactivate',
  USER_RESET_PASSWORD = 'user:reset-password',
  USER_ASSIGN_ROLE = 'user:assign-role',

  // File Management
  FILE_UPLOAD = 'file:upload',
  FILE_DOWNLOAD = 'file:download',
  FILE_READ = 'file:read',
  FILE_DELETE = 'file:delete',
  FILE_MANAGE = 'file:manage',
  FILE_SHARE = 'file:share',

  // Admin
  ADMIN_ACCESS = 'admin:access',
  ADMIN_AUDIT_READ = 'admin:audit-read',
  ADMIN_SYSTEM_MANAGE = 'admin:system-manage',

  // Audit
  AUDIT_READ = 'audit:read',
  AUDIT_EXPORT = 'audit:export',
}

/**
 * Default permissions assigned to each role.
 * Forms the basis of the RBAC permission matrix.
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: Object.values(Permission), // All permissions
  ADMIN: [
    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_ACTIVATE,
    Permission.USER_DEACTIVATE,
    Permission.USER_RESET_PASSWORD,
    Permission.USER_ASSIGN_ROLE,
    Permission.FILE_UPLOAD,
    Permission.FILE_DOWNLOAD,
    Permission.FILE_READ,
    Permission.FILE_DELETE,
    Permission.FILE_MANAGE,
    Permission.FILE_SHARE,
    Permission.ADMIN_ACCESS,
    Permission.ADMIN_AUDIT_READ,
    Permission.AUDIT_READ,
  ],
  MANAGER: [
    Permission.USER_READ,
    Permission.FILE_UPLOAD,
    Permission.FILE_DOWNLOAD,
    Permission.FILE_READ,
    Permission.FILE_DELETE,
    Permission.FILE_SHARE,
    Permission.ADMIN_ACCESS,
    Permission.AUDIT_READ,
  ],
  EMPLOYEE: [
    Permission.FILE_UPLOAD,
    Permission.FILE_DOWNLOAD,
    Permission.FILE_READ,
    Permission.FILE_DELETE,
    Permission.FILE_SHARE,
  ],
  VIEWER: [
    Permission.FILE_DOWNLOAD,
    Permission.FILE_READ,
  ],
};
