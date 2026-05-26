import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * Database module that configures MongoDB connection via Mongoose.
 * Uses async factory to pull connection string from ConfigService.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
        dbName: configService.get<string>('database.dbName'),
        // Connection pool settings for production scalability
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        // Auto-index creation (disable in production for performance)
        autoIndex: configService.get<string>('app.env') !== 'production',
      }),
    }),
  ],
})
export class DatabaseModule {}
