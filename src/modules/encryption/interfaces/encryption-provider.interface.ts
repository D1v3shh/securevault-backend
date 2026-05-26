/**
 * Encryption provider interface.
 * Abstracts symmetric encryption operations.
 * Implementations can use local crypto or cloud KMS.
 */
export interface IEncryptionProvider {
  /**
   * Encrypt data buffer.
   * @param data Plaintext data
   * @param key Optional encryption key (uses managed key if not provided)
   * @returns Encrypted data with IV and auth tag prepended
   */
  encrypt(data: Buffer, key?: Buffer): Promise<EncryptionResult>;

  /**
   * Decrypt data buffer.
   * @param encryptedData Encrypted data (with IV and auth tag)
   * @param key Optional decryption key
   * @returns Decrypted plaintext data
   */
  decrypt(encryptedData: Buffer, key?: Buffer, iv?: Buffer, authTag?: Buffer): Promise<Buffer>;
}

/**
 * Result of an encryption operation.
 */
export interface EncryptionResult {
  /** Encrypted data */
  encryptedData: Buffer;
  /** Initialization vector used */
  iv: Buffer;
  /** Authentication tag (for AEAD ciphers like AES-GCM) */
  authTag: Buffer;
}

export const ENCRYPTION_PROVIDER = 'ENCRYPTION_PROVIDER';
