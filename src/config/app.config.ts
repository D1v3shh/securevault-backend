import { registerAs } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, parse } from 'path';

/**
 * Resolve the application version from the nearest package.json.
 *
 * Walks up from `startDir` until a package.json with a version is found, so the
 * lookup works both from src/config (ts-node) and dist/config (compiled build),
 * where a fixed relative path would resolve outside the project and throw ENOENT.
 */
function resolveAppVersion(startDir: string): string {
  const { root } = parse(startDir);
  let dir = startDir;

  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          version?: string;
        };
        if (parsed.version) {
          return parsed.version;
        }
      } catch {
        // Unreadable or malformed package.json — keep walking up.
      }
    }

    if (dir === root) {
      return '0.0.0';
    }
    dir = dirname(dir);
  }
}

const appVersion = resolveAppVersion(__dirname);

export default registerAs('app', () => ({
  name: process.env.APP_NAME || 'SecureVault',
  version: appVersion,
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
