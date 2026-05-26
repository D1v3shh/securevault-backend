/**
 * Key Management Provider interface.
 * Abstracts encryption key lifecycle operations.
 * Implementations: Vault KV, AWS KMS, Azure Key Vault, etc.
 */
export interface IKeyManagementProvider {
  /**
   * Generate a new data encryption key (DEK).
   * @returns Key ID and the key material
   */
  generateKey(): Promise<GeneratedKey>;

  /**
   * Encrypt a DEK with the Key Encryption Key (KEK).
   * Used in envelope encryption.
   * @param key The plaintext DEK
   * @returns Encrypted DEK
   */
  encryptKey(key: Buffer): Promise<Buffer>;

  /**
   * Decrypt a previously encrypted DEK.
   * @param encryptedKey The encrypted DEK
   * @returns Plaintext DEK
   */
  decryptKey(encryptedKey: Buffer): Promise<Buffer>;

  /**
   * Rotate the master Key Encryption Key (KEK).
   * All existing DEKs remain valid — they'll be re-encrypted on next access.
   */
  rotateKey(): Promise<void>;

  /**
   * Retrieve a specific key by its ID.
   * @param keyId Unique key identifier
   */
  getKey(keyId: string): Promise<Buffer | null>;

  /**
   * Store a key with a specific ID.
   * @param keyId Unique key identifier
   * @param key Key material
   */
  storeKey(keyId: string, key: Buffer): Promise<void>;

  /**
   * Delete a key by ID.
   * @param keyId Unique key identifier
   */
  deleteKey(keyId: string): Promise<void>;
}

export interface GeneratedKey {
  /** Unique identifier for this key */
  keyId: string;
  /** The plaintext key material */
  key: Buffer;
  /** The encrypted version of the key (encrypted by KEK) */
  encryptedKey: Buffer;
}

export const KEY_MANAGEMENT_PROVIDER = 'KEY_MANAGEMENT_PROVIDER';
