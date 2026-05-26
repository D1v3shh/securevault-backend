import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  type: process.env.STORAGE_TYPE || 'local',
  localPath: process.env.STORAGE_LOCAL_PATH || './storage/uploads',
  tempPath: process.env.STORAGE_TEMP_PATH || './storage/temp',
  maxFileSize: parseInt(process.env.STORAGE_MAX_FILE_SIZE || '104857600', 10), // 100MB default
}));
