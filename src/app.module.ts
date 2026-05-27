import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import configModules from './config/configuration';
import { validateEnv } from './config/env.validation';

import { DatabaseModule } from './modules/database/database.module';
import { VaultModule } from './modules/vault/vault.module';
import { EncryptionModule } from './modules/encryption/encryption.module';
import { StorageModule } from './modules/storage/storage.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { FilesModule } from './modules/files/files.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { QueueModule } from './modules/queue/queue.module';
import { RedisModule } from './modules/redis/redis.module';

// ─── New PKI / Enrollment Modules ────────────────────
import { DevicesModule } from './modules/devices/devices.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { SetupModule } from './modules/setup/setup.module';
import { SessionsModule } from './modules/sessions/sessions.module';

// ─── Development Testing Module (non-production only) ───
import { DevTestModule } from './modules/dev/dev-test.module';

import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';

import { UsersService } from './modules/users/users.service';

/**
 * Root application module.
 * Wires all feature modules together with global providers.
 */
@Module({
  imports: [
    // ─── Configuration ──────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: configModules,
      validate: validateEnv,
      expandVariables: true,
    }),

    // ─── Rate Limiting ──────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],

      useFactory: (config: ConfigService) => [
        {
          ttl:
            parseInt(
              config.get<string>(
                'RATE_LIMIT_TTL',
                '60',
              ),
              10,
            ) * 1000,

          limit: parseInt(
            config.get<string>(
              'RATE_LIMIT_MAX',
              '100',
            ),
            10,
          ),
        },
      ],
    }),

    // ─── Infrastructure ─────────────────────────────
    RedisModule,
    DatabaseModule,
    VaultModule,
    EncryptionModule,
    StorageModule,

    // ─── Core Feature Modules ───────────────────────
    PermissionsModule,
    UsersModule,
    AuthModule,
    AuditModule,
    FilesModule,
    AdminModule,
    HealthModule,
    QueueModule,

    // ─── PKI & Device Trust Modules ─────────────────
    DevicesModule,
    CertificatesModule,
    SetupModule,
    SessionsModule,

    // ─── Dev Testing (non-production only) ──────────
    ...(process.env.NODE_ENV !== 'production' ? [DevTestModule] : []),
  ],

  providers: [
    // ─── Global Guards ──────────────────────────────
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },

    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },

    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) { }

  /**
   * Seed the super admin account on first startup.
   */
  async onModuleInit(): Promise<void> {
    const email = this.configService.get<string>(
      'SEED_SUPER_ADMIN_EMAIL',
    );

    const password = this.configService.get<string>(
      'SEED_SUPER_ADMIN_PASSWORD',
    );

    const firstName = this.configService.get<string>(
      'SEED_SUPER_ADMIN_FIRST_NAME',
      'Super',
    );

    const lastName = this.configService.get<string>(
      'SEED_SUPER_ADMIN_LAST_NAME',
      'Admin',
    );

    if (email && password) {
      await this.usersService.seedSuperAdmin(
        email,
        password,
        firstName,
        lastName,
      );
    } else {
      this.logger.warn(
        'Super admin seed credentials not configured. Set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD.',
      );
    }
  }
}