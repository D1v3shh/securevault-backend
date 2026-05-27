import { z } from 'zod';

/**
 * Zod schema for environment variable validation.
 * Ensures all required config is present at startup.
 */
export const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().default('SecureVault'),
  APP_PORT: z.string().regex(/^\d+$/).default('3000'),
  APP_HOST: z.string().default('0.0.0.0'),
  API_PREFIX: z.string().default('api/v1'),
  APP_CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // MongoDB
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().default('securevault'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().regex(/^\d+$/).default('6379'),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.string().regex(/^\d+$/).default('0'),
  REDIS_KEY_PREFIX: z.string().default('sv:'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRATION: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRATION: z.string().default('7d'),

  // Vault (KV Secrets)
  VAULT_ENABLED: z.string().default('false'),
  VAULT_ADDR: z.string().default('http://localhost:8200'),
  VAULT_TOKEN: z.string().optional().default(''),
  VAULT_MOUNT_PATH: z.string().default('secret'),
  VAULT_SECRETS_PATH: z.string().default('securevault'),
  VAULT_TRANSIT_ENGINE: z.string().default('transit'),
  VAULT_RETRY_ATTEMPTS: z.string().regex(/^\d+$/).default('3'),
  VAULT_RETRY_DELAY_MS: z.string().regex(/^\d+$/).default('1000'),

  // Vault PKI
  VAULT_PKI_PATH: z.string().default('pki_int'),
  VAULT_PKI_ROLE: z.string().default('securevault-device'),

  // Storage
  STORAGE_TYPE: z.enum(['local', 's3', 'minio', 'azure', 'gcs']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage/uploads'),
  STORAGE_TEMP_PATH: z.string().default('./storage/temp'),
  STORAGE_MAX_FILE_SIZE: z.string().regex(/^\d+$/).default('104857600'),

  // Encryption
  ENCRYPTION_ALGORITHM: z.string().default('aes-256-gcm'),
  ENCRYPTION_KEY_LENGTH: z.string().regex(/^\d+$/).default('32'),
  ENCRYPTION_IV_LENGTH: z.string().regex(/^\d+$/).default('16'),
  ENCRYPTION_AUTH_TAG_LENGTH: z.string().regex(/^\d+$/).default('16'),

  // Rate Limiting
  RATE_LIMIT_TTL: z.string().regex(/^\d+$/).default('60'),
  RATE_LIMIT_MAX: z.string().regex(/^\d+$/).default('100'),
  RATE_LIMIT_AUTH_TTL: z.string().regex(/^\d+$/).default('60'),
  RATE_LIMIT_AUTH_MAX: z.string().regex(/^\d+$/).default('10'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'verbose']).default('debug'),
  LOG_DIR: z.string().default('./logs'),

  // Super Admin Seed
  SEED_SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SEED_SUPER_ADMIN_PASSWORD: z.string().min(8).optional(),
  SEED_SUPER_ADMIN_FIRST_NAME: z.string().optional(),
  SEED_SUPER_ADMIN_LAST_NAME: z.string().optional(),

  // BullMQ
  BULL_QUEUE_PREFIX: z.string().default('sv-queue'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validate environment variables at startup.
 * Throws with detailed errors if validation fails.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues
      .map((err: any) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`\n❌ Environment validation failed:\n${errors}\n`);
  }

  return result.data;
}
