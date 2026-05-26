/**
 * Queue name constants for BullMQ.
 * Centralized to ensure consistency across producers and consumers.
 */
export const QUEUE_NAMES = {
  AUDIT: 'audit-log',
  FILE_PROCESSING: 'file-processing',
  NOTIFICATIONS: 'notifications',
} as const;

/**
 * Job name constants within each queue.
 */
export const JOB_NAMES = {
  // Audit queue
  LOG_AUDIT_EVENT: 'log-audit-event',

  // File processing queue
  SCAN_FILE: 'scan-file',
  GENERATE_THUMBNAIL: 'generate-thumbnail',
  CLEANUP_EXPIRED: 'cleanup-expired-files',

  // Notification queue
  SEND_EMAIL: 'send-email',
  SEND_NOTIFICATION: 'send-notification',
} as const;
