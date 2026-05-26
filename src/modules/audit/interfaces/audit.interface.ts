/**
 * Audit action types for structured logging.
 */
export enum AuditAction {
  // Auth
  LOGIN_SUCCESS = 'auth.login.success',
  LOGIN_FAILURE = 'auth.login.failure',
  LOGOUT = 'auth.logout',
  TOKEN_REFRESH = 'auth.token.refresh',
  PASSWORD_CHANGE = 'auth.password.change',
  PASSWORD_RESET = 'auth.password.reset',
  FORCE_PASSWORD_CHANGE = 'auth.password.force_change',

  // User Management
  USER_CREATE = 'user.create',
  USER_UPDATE = 'user.update',
  USER_ACTIVATE = 'user.activate',
  USER_DEACTIVATE = 'user.deactivate',
  USER_ROLE_CHANGE = 'user.role.change',
  USER_DELETE = 'user.delete',

  // File Management
  FILE_UPLOAD = 'file.upload',
  FILE_DOWNLOAD = 'file.download',
  FILE_DELETE = 'file.delete',
  FILE_SHARE = 'file.share',

  // Admin
  ADMIN_ACTION = 'admin.action',
  SYSTEM_CONFIG_CHANGE = 'system.config.change',
}

export interface AuditEventData {
  action: AuditAction | string;
  resource: string;
  resourceId?: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  status?: 'success' | 'failure' | 'error';
}
