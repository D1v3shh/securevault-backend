import * as crypto from 'crypto';

/**
 * Crypto utility functions for the application.
 * Low-level cryptographic operations used by the EncryptionService.
 */
export class CryptoUtil {
  /**
   * Generate a cryptographically secure random key.
   * @param length Key length in bytes (default 32 for AES-256)
   */
  static generateRandomKey(length: number = 32): Buffer {
    return crypto.randomBytes(length);
  }

  /**
   * Generate a random initialization vector.
   * @param length IV length in bytes (default 16)
   */
  static generateIV(length: number = 16): Buffer {
    return crypto.randomBytes(length);
  }

  /**
   * Generate a UUID v4.
   */
  static generateUUID(): string {
    return crypto.randomUUID();
  }

  /**
   * Compute SHA-256 hash of data.
   * @param data Buffer or string to hash
   */
  static sha256(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Compute SHA-512 hash of data.
   * @param data Buffer or string to hash
   */
  static sha512(data: Buffer | string): string {
    return crypto.createHash('sha512').update(data).digest('hex');
  }

  /**
   * Generate a secure random token (hex encoded).
   * @param bytes Number of random bytes (default 32)
   */
  static generateSecureToken(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /**
   * Generate a unique key ID for encryption keys.
   * Format: key-<timestamp>-<random>
   */
  static generateKeyId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `key-${timestamp}-${random}`;
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  static secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
