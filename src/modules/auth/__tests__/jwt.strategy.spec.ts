import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { Role } from '../../permissions/constants/roles.enum';
import {
  APP_CONSTANTS,
  INJECTION_TOKENS,
} from '../../../shared/constants/app.constants';

const ACCESS_TOKEN = 'header.payload.signature';

const accessPayload = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: '6a8dc3b7de9f9d61c183ee3f',
  uuid: 'user-uuid',
  email: 'user@company.com',
  role: Role.EMPLOYEE,
  type: 'access',
  ...overrides,
});

/** Minimal Express request exposing only what the strategy reads. */
const requestWith = (authHeader?: string) =>
  ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? authHeader : undefined,
  }) as unknown as Request;

/** Fake ExecutionContext carrying handler/class metadata and a request. */
const contextWith = (request: unknown = {}) =>
  ({
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  }) as never;

describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;
  let redis: { get: jest.Mock };

  beforeEach(async () => {
    redis = { get: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'jwt.accessSecret' ? 'access-secret' : undefined,
            ),
          },
        },
        { provide: INJECTION_TOKENS.REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── payload.type check ──────────────────────────────
  // Load-bearing: without it a refresh token is accepted as an access token.

  it('should accept an access token', async () => {
    const user = await strategy.validate(
      requestWith(`Bearer ${ACCESS_TOKEN}`),
      accessPayload(),
    );

    expect(user).toEqual({
      userId: '6a8dc3b7de9f9d61c183ee3f',
      uuid: 'user-uuid',
      email: 'user@company.com',
      role: Role.EMPLOYEE,
    });
  });

  it('should reject a refresh token presented as an access token', async () => {
    const attempt = strategy.validate(
      requestWith(`Bearer ${ACCESS_TOKEN}`),
      accessPayload({ type: 'refresh' }),
    );

    await expect(attempt).rejects.toThrow(UnauthorizedException);
    await expect(attempt).rejects.toThrow('Invalid token type');
  });

  it.each([undefined, '', 'access ', 'ACCESS'])(
    'should reject a token whose type is %p',
    async (type) => {
      await expect(
        strategy.validate(
          requestWith(`Bearer ${ACCESS_TOKEN}`),
          accessPayload({ type: type as never }),
        ),
      ).rejects.toThrow('Invalid token type');
    },
  );

  it('should check the token type before hitting Redis', async () => {
    await expect(
      strategy.validate(
        requestWith(`Bearer ${ACCESS_TOKEN}`),
        accessPayload({ type: 'refresh' }),
      ),
    ).rejects.toThrow();

    expect(redis.get).not.toHaveBeenCalled();
  });

  // ─── Redis blacklist check ───────────────────────────
  // Load-bearing: without it logout is cosmetic until the token expires.

  it('should reject a blacklisted token', async () => {
    redis.get.mockResolvedValue('1');

    const attempt = strategy.validate(
      requestWith(`Bearer ${ACCESS_TOKEN}`),
      accessPayload(),
    );

    await expect(attempt).rejects.toThrow(UnauthorizedException);
    await expect(attempt).rejects.toThrow('Token has been revoked');
  });

  it('should look the token up under the blacklist prefix', async () => {
    await strategy.validate(
      requestWith(`Bearer ${ACCESS_TOKEN}`),
      accessPayload(),
    );

    // Key format must match what AuthService.logout writes.
    expect(redis.get).toHaveBeenCalledWith(
      `${APP_CONSTANTS.TOKEN_BLACKLIST_PREFIX}${ACCESS_TOKEN}`,
    );
  });

  it('should strip the Bearer prefix before the lookup', async () => {
    await strategy.validate(
      requestWith(`Bearer ${ACCESS_TOKEN}`),
      accessPayload(),
    );

    const key = redis.get.mock.calls[0][0] as string;
    expect(key).not.toContain('Bearer');
  });

  it('should skip the lookup when no authorization header is present', async () => {
    // Documents current behaviour: passport has already validated the
    // signature, so a token extracted by other means still authenticates.
    const user = await strategy.validate(
      requestWith(undefined),
      accessPayload(),
    );

    expect(user.userId).toBe('6a8dc3b7de9f9d61c183ee3f');
    expect(redis.get).not.toHaveBeenCalled();
  });
});

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let parentCanActivate: jest.SpyInstance;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);

    // AuthGuard('jwt') sits directly above JwtAuthGuard in the prototype chain.
    parentCanActivate = jest
      .spyOn(
        Object.getPrototypeOf(JwtAuthGuard.prototype) as {
          canActivate: () => boolean;
        },
        'canActivate',
      )
      .mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should bypass authentication for @Public() routes', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(guard.canActivate(contextWith())).toBe(true);
    // Passport must not run at all for public routes.
    expect(parentCanActivate).not.toHaveBeenCalled();
  });

  it('should delegate to passport for non-public routes', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    guard.canActivate(contextWith());

    expect(parentCanActivate).toHaveBeenCalledTimes(1);
  });

  it('should read the public flag from handler and class metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    guard.canActivate(contextWith());

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });

  it('should be deny-by-default: anything not marked public goes through passport', () => {
    for (const flag of [undefined, null, false]) {
      parentCanActivate.mockClear();
      reflector.getAllAndOverride.mockReturnValue(flag);

      guard.canActivate(contextWith());

      expect(parentCanActivate).toHaveBeenCalledTimes(1);
    }
  });
});

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  const canActivateAs = (role: Role | undefined, required?: Role[]) => {
    reflector.getAllAndOverride.mockReturnValue(required);
    return guard.canActivate(
      contextWith(role ? { user: { role } } : { user: undefined }),
    );
  };

  it('should allow a route with no @Roles decorator', () => {
    expect(canActivateAs(Role.VIEWER, undefined)).toBe(true);
    expect(canActivateAs(Role.VIEWER, [])).toBe(true);
  });

  it('should allow an exactly matching role', () => {
    expect(canActivateAs(Role.ADMIN, [Role.SUPER_ADMIN, Role.ADMIN])).toBe(
      true,
    );
  });

  // ─── Exact match, not hierarchical ───────────────────

  it('should reject SUPER_ADMIN on a route that lists only ADMIN', () => {
    // This is the documented trap: RolesGuard has no hierarchy, so the highest
    // role is locked out unless it is listed. Every route must list every
    // permitted role explicitly. If this test ever fails, the guard's matching
    // semantics changed and every @Roles decorator needs auditing.
    expect(() => canActivateAs(Role.SUPER_ADMIN, [Role.ADMIN])).toThrow(
      ForbiddenException,
    );
  });

  it.each([Role.MANAGER, Role.EMPLOYEE, Role.VIEWER])(
    'should reject %s on an admin-only route',
    (role) => {
      expect(() => canActivateAs(role, [Role.SUPER_ADMIN, Role.ADMIN])).toThrow(
        ForbiddenException,
      );
    },
  );

  it('should name the required roles in the error', () => {
    expect(() => canActivateAs(Role.EMPLOYEE, [Role.SUPER_ADMIN])).toThrow(
      /Required role\(s\): SUPER_ADMIN/,
    );
  });

  it('should reject a request with no role on the user', () => {
    expect(() => canActivateAs(undefined, [Role.ADMIN])).toThrow(
      'Access denied: No role assigned',
    );
  });

  it('should read required roles from handler and class metadata', () => {
    canActivateAs(Role.ADMIN, [Role.ADMIN]);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });
});
