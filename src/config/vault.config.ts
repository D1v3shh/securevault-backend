import { registerAs } from '@nestjs/config';

export default registerAs('vault', () => ({
  enabled: process.env.VAULT_ENABLED === 'true',
  address: process.env.VAULT_ADDR || 'http://localhost:8200',
  token: process.env.VAULT_TOKEN || '',
  mountPath: process.env.VAULT_MOUNT_PATH || 'secret',
  secretsPath: process.env.VAULT_SECRETS_PATH || 'securevault',
  transitEngine: process.env.VAULT_TRANSIT_ENGINE || 'transit',
  retryAttempts: parseInt(process.env.VAULT_RETRY_ATTEMPTS || '3', 10),
  retryDelayMs: parseInt(process.env.VAULT_RETRY_DELAY_MS || '1000', 10),
}));
