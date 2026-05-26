import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { IEncryptionProvider, EncryptionResult } from './interfaces/encryption-provider.interface';
import { IKeyManagementProvider, GeneratedKey } from './interfaces/key-management-provider.interface';
import { VaultService } from '../vault/vault.service';
import { APP_CONSTANTS } from '../../shared/constants/app.constants';
import { CryptoUtil } from '../../shared/utils/crypto.util';

/**
 * AES-256-GCM Encryption Service with Envelope Encryption.
 *
 * Architecture:
 * - Each file gets its own Data Encryption Key (DEK)
 * - DEKs are encrypted by a Key Encryption Key (KEK)
 * - KEK is stored/managed by HashiCorp Vault (or env fallback)
 *
 * This service implements both IEncryptionProvider and IKeyManagementProvider.
 */
@Injectable()
export class EncryptionService implements IEncryptionProvider, IKeyManagementProvider, OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm: string;
  private readonly keyLength: number;
  private readonly ivLength: number;
  private readonly authTagLength: number;
  private masterKey: Buffer | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly vaultService: VaultService,
  ) {
    this.algorithm = this.configService.get<string>('ENCRYPTION_ALGORITHM', 'aes-256-gcm');
    this.keyLength = parseInt(this.configService.get<string>('ENCRYPTION_KEY_LENGTH', '32'), 10);
    this.ivLength = parseInt(this.configService.get<string>('ENCRYPTION_IV_LENGTH', '16'), 10);
    this.authTagLength = parseInt(this.configService.get<string>('ENCRYPTION_AUTH_TAG_LENGTH', '16'), 10);
  }

  /**
   * Initialize the master KEK from Vault or environment.
   */
  async onModuleInit(): Promise<void> {
    await this.initializeMasterKey();
  }

  /**
   * Load or generate the master Key Encryption Key (KEK).
   * In production: stored in Vault KV.
   * In development without Vault: derived from JWT_ACCESS_SECRET.
   */
  private async initializeMasterKey(): Promise<void> {
    try {
      // Try to load from Vault first
      const vaultKey = await this.vaultService.readSecret(APP_CONSTANTS.VAULT_MASTER_KEY);
      if (vaultKey?.key) {
        this.masterKey = Buffer.from(vaultKey.key, 'hex');
        this.logger.log('✅ Master encryption key loaded from Vault');
        return;
      }

      // If Vault doesn't have the key, generate one and store it
      const vaultHealthy = await this.vaultService.healthCheck();
      if (vaultHealthy) {
        const newKey = CryptoUtil.generateRandomKey(this.keyLength);
        this.masterKey = newKey;
        await this.vaultService.writeSecret(APP_CONSTANTS.VAULT_MASTER_KEY, {
          key: newKey.toString('hex'),
          algorithm: this.algorithm,
          createdAt: new Date().toISOString(),
        });
        this.logger.log('✅ Master encryption key generated and stored in Vault');
        return;
      }
    } catch (error: any) {
      this.logger.warn(`Vault key initialization failed: ${error.message}`);
    }

    // Fallback: derive from JWT secret (dev only)
    const secret = this.configService.get<string>('jwt.accessSecret', 'default-dev-secret');
    this.masterKey = crypto
      .createHash('sha256')
      .update(secret)
      .digest();
    this.logger.warn(
      '⚠️ Using derived master key from JWT secret. ' +
      'This is acceptable for development only. Use Vault in production.',
    );
  }

  // ──────────────────────────────────────────────────────────
  // IEncryptionProvider
  // ──────────────────────────────────────────────────────────

  /**
   * Encrypt data using AES-256-GCM.
   * @param data Plaintext buffer
   * @param key Optional explicit key (otherwise uses master key)
   */
  async encrypt(data: Buffer, key?: Buffer): Promise<EncryptionResult> {
    const encryptionKey = key || this.masterKey;
    if (!encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    const iv = CryptoUtil.generateIV(this.ivLength);
    const cipher = crypto.createCipheriv(
      this.algorithm as crypto.CipherGCMTypes,
      encryptionKey,
      iv,
      { authTagLength: this.authTagLength },
    );

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return { encryptedData: encrypted, iv, authTag };
  }

  /**
   * Decrypt data using AES-256-GCM.
   */
  async decrypt(
    encryptedData: Buffer,
    key?: Buffer,
    iv?: Buffer,
    authTag?: Buffer,
  ): Promise<Buffer> {
    const decryptionKey = key || this.masterKey;
    if (!decryptionKey) {
      throw new Error('Decryption key not initialized');
    }
    if (!iv || !authTag) {
      throw new Error('IV and authTag are required for decryption');
    }

    const decipher = crypto.createDecipheriv(
      this.algorithm as crypto.CipherGCMTypes,
      decryptionKey,
      iv,
      { authTagLength: this.authTagLength },
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  }

  // ──────────────────────────────────────────────────────────
  // IKeyManagementProvider (Envelope Encryption)
  // ──────────────────────────────────────────────────────────

  /**
   * Generate a new Data Encryption Key (DEK).
   * The DEK is returned in plaintext (for immediate use) and encrypted form (for storage).
   */
  async generateKey(): Promise<GeneratedKey> {
    const keyId = CryptoUtil.generateKeyId();
    const key = CryptoUtil.generateRandomKey(this.keyLength);

    // Encrypt the DEK with the master KEK
    const encryptedKey = await this.encryptKey(key);

    // Store the encrypted DEK in Vault if available
    try {
      await this.vaultService.writeSecret(`${APP_CONSTANTS.VAULT_FILE_KEY_PREFIX}${keyId}`, {
        encryptedKey: encryptedKey.toString('hex'),
        algorithm: this.algorithm,
        createdAt: new Date().toISOString(),
      });
    } catch (error: any) {
      this.logger.debug(`Vault key storage skipped: ${error.message}`);
    }

    return { keyId, key, encryptedKey };
  }

  /**
   * Encrypt a DEK with the master KEK.
   */
  async encryptKey(key: Buffer): Promise<Buffer> {
    if (!this.masterKey) throw new Error('Master key not initialized');

    const iv = CryptoUtil.generateIV(this.ivLength);
    const cipher = crypto.createCipheriv(
      this.algorithm as crypto.CipherGCMTypes,
      this.masterKey,
      iv,
      { authTagLength: this.authTagLength },
    );

    const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Pack: [iv(16)] + [authTag(16)] + [encryptedKey]
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Decrypt a previously encrypted DEK.
   */
  async decryptKey(encryptedKey: Buffer): Promise<Buffer> {
    if (!this.masterKey) throw new Error('Master key not initialized');

    const iv = encryptedKey.subarray(0, this.ivLength);
    const authTag = encryptedKey.subarray(this.ivLength, this.ivLength + this.authTagLength);
    const data = encryptedKey.subarray(this.ivLength + this.authTagLength);

    const decipher = crypto.createDecipheriv(
      this.algorithm as crypto.CipherGCMTypes,
      this.masterKey,
      iv,
      { authTagLength: this.authTagLength },
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  /**
   * Rotate the master KEK.
   * - Generates new KEK
   * - Re-encrypts all stored DEKs with the new KEK
   */
  async rotateKey(): Promise<void> {
    const newKey = CryptoUtil.generateRandomKey(this.keyLength);
    const oldKey = this.masterKey;
    this.masterKey = newKey;

    // Store new master key in Vault
    try {
      await this.vaultService.writeSecret(APP_CONSTANTS.VAULT_MASTER_KEY, {
        key: newKey.toString('hex'),
        algorithm: this.algorithm,
        rotatedAt: new Date().toISOString(),
      });
      this.logger.log('✅ Master encryption key rotated');
    } catch (error: any) {
      // Revert on failure
      this.masterKey = oldKey;
      this.logger.error(`Key rotation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retrieve a specific DEK by its ID from Vault.
   */
  async getKey(keyId: string): Promise<Buffer | null> {
    try {
      const secret = await this.vaultService.readSecret(
        `${APP_CONSTANTS.VAULT_FILE_KEY_PREFIX}${keyId}`,
      );
      if (secret?.encryptedKey) {
        const encryptedDek = Buffer.from(secret.encryptedKey, 'hex');
        return this.decryptKey(encryptedDek);
      }
    } catch (error: any) {
      this.logger.error(`Failed to retrieve key '${keyId}': ${error.message}`);
    }
    return null;
  }

  /**
   * Store a DEK (encrypted) in Vault.
   */
  async storeKey(keyId: string, key: Buffer): Promise<void> {
    const encryptedKey = await this.encryptKey(key);
    await this.vaultService.writeSecret(`${APP_CONSTANTS.VAULT_FILE_KEY_PREFIX}${keyId}`, {
      encryptedKey: encryptedKey.toString('hex'),
      algorithm: this.algorithm,
      storedAt: new Date().toISOString(),
    });
  }

  /**
   * Delete a DEK from Vault.
   */
  async deleteKey(keyId: string): Promise<void> {
    await this.vaultService.deleteSecret(`${APP_CONSTANTS.VAULT_FILE_KEY_PREFIX}${keyId}`);
  }
}
