/**
 * Status of a file share record.
 *
 * ACTIVE  — Share is valid and access is allowed (subject to expiration check).
 * EXPIRED — Share has passed its expiration timestamp (set lazily on access check).
 * REVOKED — Share was manually revoked by the file owner.
 */
export enum ShareStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}
