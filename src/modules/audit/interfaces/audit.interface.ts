/**
 * Audit action types for structured logging.
 * Covers all security-relevant events across the platform.
 */
export enum AuditAction {
  // ─── Auth ──────────────────────────────────────────
  LOGIN_SUCCESS = 'auth.login.success',
  LOGIN_FAILURE = 'auth.login.failure',
  LOGOUT = 'auth.logout',
  TOKEN_REFRESH = 'auth.token.refresh',
  PASSWORD_CHANGE = 'auth.password.change',
  PASSWORD_RESET = 'auth.password.reset',
  FORCE_PASSWORD_CHANGE = 'auth.password.force_change',

  // ─── Certificate Auth ──────────────────────────────
  CERT_LOGIN_SUCCESS = 'auth.cert_login.success',
  CERT_LOGIN_FAILURE = 'auth.cert_login.failure',

  // ─── User Management ──────────────────────────────
  USER_CREATE = 'user.create',
  USER_UPDATE = 'user.update',
  USER_ACTIVATE = 'user.activate',
  USER_DEACTIVATE = 'user.deactivate',
  USER_ROLE_CHANGE = 'user.role.change',
  USER_DELETE = 'user.delete',

  // ─── Device Management ────────────────────────────
  DEVICE_ENROLLMENT = 'device.enrollment',
  DEVICE_REGISTER = 'device.register',
  DEVICE_APPROVE = 'device.approve',
  DEVICE_REVOKE = 'device.revoke',
  DEVICE_BLOCK = 'device.block',
  DEVICE_STATUS_CHANGE = 'device.status.change',

  // ─── Certificate Management ───────────────────────
  CERTIFICATE_ISSUE = 'certificate.issue',
  CERTIFICATE_REVOKE = 'certificate.revoke',
  CERTIFICATE_RENEWAL = 'certificate.renewal',
  CERTIFICATE_VERIFY = 'certificate.verify',

  // ─── Enrollment ───────────────────────────────────
  ENROLLMENT_TOKEN_CREATE = 'enrollment.token.create',
  ENROLLMENT_FAILURE = 'enrollment.failure',

  // ─── Session ──────────────────────────────────────
  SESSION_CREATE = 'session.create',
  SESSION_END = 'session.end',

  // ─── File Management ──────────────────────────────
  FILE_UPLOAD = 'file.upload',
  FILE_DOWNLOAD = 'file.download',
  FILE_DELETE = 'file.delete',
  FILE_SHARE = 'file.share',

  // ─── Admin ────────────────────────────────────────
  ADMIN_ACTION = 'admin.action',
  SYSTEM_CONFIG_CHANGE = 'system.config.change',

  // ─── Suspicious Activity ──────────────────────────
  SUSPICIOUS_ACTIVITY = 'security.suspicious_activity',
  FINGERPRINT_MISMATCH = 'security.fingerprint_mismatch',
  REVOKED_CERT_LOGIN = 'security.revoked_cert_login',
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
