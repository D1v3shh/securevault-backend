import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IVaultProvider } from './interfaces/vault-provider.interface';

/**
 * HashiCorp Vault service implementation.
 * Provides secret management, transit encryption, and key management.
 *
 * In development mode with Vault disabled, falls back to environment variables.
 * In production, all secrets MUST come from Vault.
 */
@Injectable()
export class VaultService implements IVaultProvider, OnModuleInit {
  private readonly logger = new Logger(VaultService.name);
  private client: any = null;
  private readonly enabled: boolean;
  private readonly address: string;
  private readonly token: string;
  private readonly mountPath: string;
  private readonly secretsPath: string;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('vault.enabled', false);
    this.address = this.configService.get<string>('vault.address', 'http://localhost:8200');
    this.token = this.configService.get<string>('vault.token', '');
    this.mountPath = this.configService.get<string>('vault.mountPath', 'secret');
    this.secretsPath = this.configService.get<string>('vault.secretsPath', 'securevault');
    this.retryAttempts = this.configService.get<number>('vault.retryAttempts', 3);
    this.retryDelayMs = this.configService.get<number>('vault.retryDelayMs', 1000);
  }

  async onModuleInit(): Promise<void> {
    if (this.enabled) {
      await this.initialize();
    } else {
      this.logger.warn(
        'Vault is DISABLED. Using environment variables for secrets. ' +
        'This is acceptable for development only.',
      );
    }
  }

  /**
   * Initialize Vault client with retry logic.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        this.logger.log(`Connecting to Vault at ${this.address} (attempt ${attempt}/${this.retryAttempts})`);

        // Dynamic import to avoid hard dependency when Vault is disabled
        const vault = require('node-vault');
        this.client = vault({
          apiVersion: 'v1',
          endpoint: this.address,
          token: this.token,
        });

        // Verify connection with health check
        const health = await this.client.health();
        this.initialized = true;
        this.logger.log(`✅ Vault connected successfully. Sealed: ${health.sealed}`);
        return;
      } catch (error: any) {
        this.logger.error(
          `Vault connection attempt ${attempt} failed: ${error.message}`,
        );

        if (attempt < this.retryAttempts) {
          await this.delay(this.retryDelayMs * attempt);
        }
      }
    }

    this.logger.error(
      `Failed to connect to Vault after ${this.retryAttempts} attempts. ` +
      'Falling back to environment variables.',
    );
  }

  /**
   * Read a secret from the Vault KV v2 engine.
   */
  async readSecret(path: string): Promise<Record<string, any> | null> {
    if (!this.enabled || !this.client) {
      this.logger.debug(`Vault disabled — readSecret('${path}') returning null`);
      return null;
    }

    try {
      const fullPath = `${this.mountPath}/data/${this.secretsPath}/${path}`;
      const result = await this.client.read(fullPath);
      return result?.data?.data || null;
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        this.logger.debug(`Secret not found at path: ${path}`);
        return null;
      }
      this.logger.error(`Failed to read secret at '${path}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Write a secret to the Vault KV v2 engine.
   */
  async writeSecret(path: string, data: Record<string, any>): Promise<void> {
    if (!this.enabled || !this.client) {
      this.logger.warn(`Vault disabled — cannot write secret to '${path}'`);
      return;
    }

    try {
      const fullPath = `${this.mountPath}/data/${this.secretsPath}/${path}`;
      await this.client.write(fullPath, { data });
      this.logger.debug(`Secret written to path: ${path}`);
    } catch (error: any) {
      this.logger.error(`Failed to write secret at '${path}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a secret from the Vault KV v2 engine.
   */
  async deleteSecret(path: string): Promise<void> {
    if (!this.enabled || !this.client) {
      this.logger.warn(`Vault disabled — cannot delete secret at '${path}'`);
      return;
    }

    try {
      const fullPath = `${this.mountPath}/data/${this.secretsPath}/${path}`;
      await this.client.delete(fullPath);
      this.logger.debug(`Secret deleted at path: ${path}`);
    } catch (error: any) {
      this.logger.error(`Failed to delete secret at '${path}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Check Vault health status.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      if (!this.client) return false;
      const health = await this.client.health();
      return !health.sealed;
    } catch {
      return false;
    }
  }

  /**
   * Encrypt data using Vault Transit engine.
   * Future-ready — will use transit/encrypt endpoint.
   */
  async transitEncrypt(keyName: string, plaintext: string): Promise<string> {
    if (!this.enabled || !this.client) {
      this.logger.warn('Vault transit encrypt unavailable — Vault disabled');
      throw new Error('Vault transit engine not available');
    }

    try {
      const result = await this.client.write(`transit/encrypt/${keyName}`, {
        plaintext: Buffer.from(plaintext).toString('base64'),
      });
      return result.data.ciphertext;
    } catch (error: any) {
      this.logger.error(`Transit encrypt failed for key '${keyName}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Decrypt data using Vault Transit engine.
   */
  async transitDecrypt(keyName: string, ciphertext: string): Promise<string> {
    if (!this.enabled || !this.client) {
      throw new Error('Vault transit engine not available');
    }

    try {
      const result = await this.client.write(`transit/decrypt/${keyName}`, {
        ciphertext,
      });
      return Buffer.from(result.data.plaintext, 'base64').toString('utf8');
    } catch (error: any) {
      this.logger.error(`Transit decrypt failed for key '${keyName}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a data key via Transit engine (envelope encryption).
   */
  async generateDataKey(keyName: string): Promise<{ plaintext: string; ciphertext: string }> {
    if (!this.enabled || !this.client) {
      throw new Error('Vault transit engine not available');
    }

    try {
      const result = await this.client.write(`transit/datakey/plaintext/${keyName}`, {});
      return {
        plaintext: result.data.plaintext,
        ciphertext: result.data.ciphertext,
      };
    } catch (error: any) {
      this.logger.error(`Data key generation failed for '${keyName}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Rotate an encryption key in the Transit engine.
   */
  async rotateKey(keyName: string): Promise<void> {
    if (!this.enabled || !this.client) {
      throw new Error('Vault transit engine not available');
    }

    try {
      await this.client.write(`transit/keys/${keyName}/rotate`, {});
      this.logger.log(`Encryption key '${keyName}' rotated successfully`);
    } catch (error: any) {
      this.logger.error(`Key rotation failed for '${keyName}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a secret value, falling back to environment variable if Vault is disabled.
   */
  async getSecretOrEnv(vaultPath: string, envKey: string): Promise<string> {
    if (this.enabled) {
      const secret = await this.readSecret(vaultPath);
      if (secret && secret[envKey]) {
        return secret[envKey];
      }
    }
    return this.configService.get<string>(envKey, '');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
