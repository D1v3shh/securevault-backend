import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import Redis from 'ioredis';
import { Public } from '../auth/decorators/public.decorator';
import { VaultService } from '../vault/vault.service';
import { INJECTION_TOKENS } from '../../shared/constants/app.constants';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly vaultService: VaultService,
    @Inject(INJECTION_TOKENS.REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Application health check' })
  async healthCheck() {
    const mongoStatus = this.getMongoStatus();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: this.configService.get<string>('app.name', 'SecureVault'),
      version: this.configService.get<string>('app.version', '1.0.0'),
      environment: this.configService.get<string>('app.env'),
      checks: {
        mongodb: {
          status: mongoStatus === 1 ? 'up' : 'down',
          readyState: mongoStatus,
        },
      },
    };
  }

  @Get('detailed')
  @ApiOperation({ summary: 'Detailed health check (authenticated)' })
  async detailedHealthCheck() {
    const mongoStatus = this.getMongoStatus();
    const vaultHealthy = await this.vaultService.healthCheck();
    const redisHealthy = await this.checkRedisHealth();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: this.configService.get<string>('app.name'),
      version: this.configService.get<string>('app.version', '1.0.0'),
      environment: this.configService.get<string>('app.env'),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      checks: {
        mongodb: {
          status: mongoStatus === 1 ? 'up' : 'down',
          readyState: mongoStatus,
        },
        redis: {
          status: redisHealthy ? 'up' : 'down',
        },
        vault: {
          status: vaultHealthy ? 'up' : 'down',
          enabled: this.configService.get<string>('VAULT_ENABLED') === 'true',
        },
      },
    };
  }

  private getMongoStatus(): number {
    return this.mongoConnection.readyState;
  }

  private async checkRedisHealth(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
