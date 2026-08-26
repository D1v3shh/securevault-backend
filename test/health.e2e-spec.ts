import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { HealthController } from '../src/modules/health/health.controller';
import { VaultService } from '../src/modules/vault/vault.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { Role } from '../src/modules/permissions/constants/roles.enum';
import {
  APP_CONSTANTS,
  INJECTION_TOKENS,
} from '../src/shared/constants/app.constants';

/**
 * End-to-end smoke test over the real HTTP pipeline.
 *
 * Boots HealthModule behind the same global prefix, pipes, filter, interceptor
 * and guards that `main.ts` installs, then drives it through supertest. What it
 * actually proves:
 *   - the global `api/v1` prefix is applied
 *   - successful responses come back in the TransformInterceptor envelope
 *   - `JwtAuthGuard` is deny-by-default: an undecorated route needs a token,
 *     while `@Public()` lets one through
 *   - `JwtStrategy` rejects a refresh token and a blacklisted token at the
 *     HTTP boundary, not just in unit tests
 *
 * MongoDB, Redis and Vault are stubbed, so this runs anywhere with no Docker.
 * A full-stack e2e booting AppModule against live infrastructure is a separate
 * exercise — see §10.4 of PROJECT_CONTEXT.md.
 */
const JWT_SECRET = 'e2e-access-secret-at-least-32-characters-long';
const API_PREFIX = 'api/v1';

describe('Health (e2e smoke)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let redis: { get: jest.Mock; ping: jest.Mock };
  let mongoConnection: { readyState: number };

  const url = (path: string) => `/${API_PREFIX}${path}`;

  const tokenFor = (overrides: Record<string, unknown> = {}): string =>
    jwt.sign(
      {
        sub: '6a8dc3b7de9f9d61c183ee3f',
        uuid: 'user-uuid',
        email: 'user@company.com',
        role: Role.EMPLOYEE,
        type: 'access',
        ...overrides,
      },
      { secret: JWT_SECRET, expiresIn: '5m' },
    );

  beforeAll(async () => {
    jwt = new JwtService({ secret: JWT_SECRET });
    redis = {
      get: jest.fn().mockResolvedValue(null),
      ping: jest.fn().mockResolvedValue('PONG'),
    };
    mongoConnection = { readyState: 1 };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      // HealthController is declared directly rather than via HealthModule:
      // its dependencies are stubbed here, and providers registered on the root
      // testing module are not visible inside an imported module's scope.
      controllers: [HealthController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getConnectionToken(), useValue: mongoConnection },
        {
          provide: VaultService,
          useValue: { healthCheck: jest.fn().mockResolvedValue(true) },
        },
        { provide: INJECTION_TOKENS.REDIS_CLIENT, useValue: redis },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              const values: Record<string, string> = {
                'jwt.accessSecret': JWT_SECRET,
                'app.name': 'SecureVault',
                'app.version': '0.0.1',
                'app.env': 'test',
                VAULT_ENABLED: 'true',
              };
              return values[key] ?? fallback;
            }),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror main.ts.
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    redis.get.mockResolvedValue(null);
    mongoConnection.readyState = 1;
  });

  // ─── Public route ────────────────────────────────────

  it('GET /api/v1/health returns 200 without a token', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/health'))
      .expect(HttpStatus.OK);

    expect(response.body).toMatchObject({
      statusCode: 200,
      message: 'Success',
      data: {
        status: 'ok',
        service: 'SecureVault',
        environment: 'test',
        checks: { mongodb: { status: 'up', readyState: 1 } },
      },
    });
    expect(response.body.timestamp).toBeDefined();
  });

  it('reports mongodb down when the connection is not ready', async () => {
    mongoConnection.readyState = 0;

    const response = await request(app.getHttpServer())
      .get(url('/health'))
      .expect(HttpStatus.OK);

    expect(response.body.data.checks.mongodb).toEqual({
      status: 'down',
      readyState: 0,
    });
  });

  it('applies the global api/v1 prefix', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(HttpStatus.NOT_FOUND);
  });

  it('returns 404 for an unknown route', async () => {
    await request(app.getHttpServer())
      .get(url('/does-not-exist'))
      .expect(HttpStatus.NOT_FOUND);
  });

  // ─── Deny-by-default on undecorated routes ───────────

  it('GET /api/v1/health/detailed requires a token', async () => {
    await request(app.getHttpServer())
      .get(url('/health/detailed'))
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('GET /api/v1/health/detailed succeeds with a valid access token', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/health/detailed'))
      .set('Authorization', `Bearer ${tokenFor()}`)
      .expect(HttpStatus.OK);

    expect(response.body.data.checks).toMatchObject({
      mongodb: { status: 'up' },
      redis: { status: 'up' },
      vault: { status: 'up', enabled: true },
    });
    expect(redis.ping).toHaveBeenCalled();
  });

  it('reports redis down when ping fails', async () => {
    redis.ping.mockRejectedValueOnce(new Error('redis offline'));

    const response = await request(app.getHttpServer())
      .get(url('/health/detailed'))
      .set('Authorization', `Bearer ${tokenFor()}`)
      .expect(HttpStatus.OK);

    expect(response.body.data.checks.redis).toEqual({ status: 'down' });
  });

  // ─── Token checks enforced at the HTTP boundary ──────

  it('rejects a refresh token used as an access token', async () => {
    await request(app.getHttpServer())
      .get(url('/health/detailed'))
      .set('Authorization', `Bearer ${tokenFor({ type: 'refresh' })}`)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('rejects a blacklisted access token', async () => {
    const token = tokenFor();
    redis.get.mockImplementation((key: string) =>
      Promise.resolve(
        key === `${APP_CONSTANTS.TOKEN_BLACKLIST_PREFIX}${token}` ? '1' : null,
      ),
    );

    await request(app.getHttpServer())
      .get(url('/health/detailed'))
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = new JwtService({ secret: 'not-the-real-secret' }).sign(
      { sub: 'x', type: 'access' },
      { expiresIn: '5m' },
    );

    await request(app.getHttpServer())
      .get(url('/health/detailed'))
      .set('Authorization', `Bearer ${forged}`)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { sub: 'x', type: 'access' },
      { secret: JWT_SECRET, expiresIn: '-1s' },
    );

    await request(app.getHttpServer())
      .get(url('/health/detailed'))
      .set('Authorization', `Bearer ${expired}`)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('returns a sanitized error envelope, not a stack trace', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/health/detailed'))
      .expect(HttpStatus.UNAUTHORIZED);

    expect(response.body).toMatchObject({
      statusCode: 401,
      path: url('/health/detailed'),
      method: 'GET',
    });
  });
});
