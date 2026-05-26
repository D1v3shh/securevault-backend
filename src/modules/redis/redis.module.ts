// src/modules/redis/redis.module.ts

import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { INJECTION_TOKENS } from '../../shared/constants/app.constants';

@Global()
@Module({
    imports: [ConfigModule],

    providers: [
        {
            provide: INJECTION_TOKENS.REDIS_CLIENT,

            useFactory: (configService: ConfigService) => {
                const logger = new Logger('RedisProvider');

                const redis = new Redis({
                    host: configService.get<string>(
                        'redis.host',
                        'localhost',
                    ),

                    port: configService.get<number>(
                        'redis.port',
                        6379,
                    ),

                    password:
                        configService.get<string>(
                            'redis.password',
                            '',
                        ) || undefined,

                    db: configService.get<number>(
                        'redis.db',
                        0,
                    ),

                    keyPrefix: configService.get<string>(
                        'REDIS_KEY_PREFIX',
                        'sv:',
                    ),

                    retryStrategy: (times: number) => {
                        if (times > 5) {
                            logger.error(
                                'Redis connection failed after 5 retries',
                            );

                            return null;
                        }

                        return Math.min(times * 200, 2000);
                    },

                    lazyConnect: true,
                });

                redis.on('connect', () => {
                    logger.log('✅ Redis connected');
                });

                redis.on('error', (err) => {
                    logger.error(`Redis error: ${err.message}`);
                });

                redis.connect().catch((err) => {
                    logger.warn(
                        `Redis initial connection failed: ${err.message}. Will retry.`,
                    );
                });

                return redis;
            },

            inject: [ConfigService],
        },
    ],

    exports: [INJECTION_TOKENS.REDIS_CLIENT],
})
export class RedisModule { }