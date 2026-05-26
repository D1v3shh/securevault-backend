import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/securevault',
  dbName: process.env.MONGODB_DB_NAME || 'securevault',
}));
