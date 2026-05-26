/**
 * Application-wide constants.
 * Centralized to avoid magic strings scattered across the codebase.
 */
export const APP_CONSTANTS = {
  /** Bcrypt hash salt rounds */
  BCRYPT_SALT_ROUNDS: 12,

  /** Maximum failed login attempts before lockout */
  MAX_FAILED_LOGIN_ATTEMPTS: 5,

  /** Account lockout duration in minutes */
  LOCKOUT_DURATION_MINUTES: 30,

  /** Token blacklist prefix in Redis */
  TOKEN_BLACKLIST_PREFIX: 'bl:token:',

  /** Refresh token prefix in Redis */
  REFRESH_TOKEN_PREFIX: 'rt:',

  /** Session prefix in Redis */
  SESSION_PREFIX: 'session:',

  /** File encryption key prefix in Vault */
  VAULT_FILE_KEY_PREFIX: 'file-keys/',

  /** Master encryption key name in Vault */
  VAULT_MASTER_KEY: 'master-encryption-key',

  /** Default pagination */
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,

  /** Allowed file MIME types */
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/zip',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'video/mp4',
    'audio/mpeg',
    'audio/wav',
  ],
} as const;

/** Queue names for BullMQ */
export const QUEUE_NAMES = {
  AUDIT: 'audit-log',
  FILE_PROCESSING: 'file-processing',
  NOTIFICATIONS: 'notifications',
} as const;

/** Injection tokens for provider abstractions */
export const INJECTION_TOKENS = {
  STORAGE_PROVIDER: 'STORAGE_PROVIDER',
  ENCRYPTION_PROVIDER: 'ENCRYPTION_PROVIDER',
  KEY_MANAGEMENT_PROVIDER: 'KEY_MANAGEMENT_PROVIDER',
  AUDIT_PROVIDER: 'AUDIT_PROVIDER',
  REDIS_CLIENT: 'REDIS_CLIENT',
} as const;
