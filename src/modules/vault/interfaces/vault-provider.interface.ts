/**
 * Vault provider interface.
 * Abstracts HashiCorp Vault operations so a different KMS backend
 * (e.g., AWS KMS, Azure Key Vault) can be swapped in without refactoring.
 */
export interface IVaultProvider {
  /**
   * Initialize and authenticate with the vault.
   */
  initialize(): Promise<void>;

  /**
   * Read a secret from the vault KV store.
   * @param path Secret path (e.g., 'securevault/jwt')
   */
  readSecret(path: string): Promise<Record<string, any> | null>;

  /**
   * Write a secret to the vault KV store.
   * @param path Secret path
   * @param data Key-value pairs to store
   */
  writeSecret(path: string, data: Record<string, any>): Promise<void>;

  /**
   * Delete a secret from the vault KV store.
   * @param path Secret path
   */
  deleteSecret(path: string): Promise<void>;

  /**
   * Check if the vault is healthy and reachable.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Encrypt data using the vault transit engine.
   * @param keyName Name of the transit encryption key
   * @param plaintext Base64-encoded plaintext
   */
  transitEncrypt(keyName: string, plaintext: string): Promise<string>;

  /**
   * Decrypt data using the vault transit engine.
   * @param keyName Name of the transit encryption key
   * @param ciphertext Vault ciphertext (vault:v1:...)
   */
  transitDecrypt(keyName: string, ciphertext: string): Promise<string>;

  /**
   * Generate a new data key using the transit engine.
   * Returns both plaintext and ciphertext versions of the key.
   */
  generateDataKey(keyName: string): Promise<{
    plaintext: string;
    ciphertext: string;
  }>;

  /**
   * Rotate the named encryption key in the transit engine.
   */
  rotateKey(keyName: string): Promise<void>;
}

export const VAULT_PROVIDER = 'VAULT_PROVIDER';
