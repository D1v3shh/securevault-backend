import { registerAs } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let packageVersion = '1.0.0';
try {
  // Try process.cwd() first (works in all contexts), then __dirname fallback
  const cwdPath = join(process.cwd(), 'package.json');
  const dirPath = join(__dirname, '..', '..', 'package.json');
  const pkgPath = existsSync(cwdPath) ? cwdPath : dirPath;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  packageVersion = pkg.version || '1.0.0';
} catch { /* use default */ }

export default registerAs('app', () => ({
  name: process.env.APP_NAME || 'SecureVault',
  version: packageVersion,
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.APP_PORT || '3000', 10),
  host: process.env.APP_HOST || '0.0.0.0',
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsOrigins: (process.env.APP_CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim()),
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
}));
