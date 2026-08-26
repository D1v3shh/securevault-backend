import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { RefreshTokenEntity } from '../../users/schemas/refresh-token.schema';
import { UsersService } from '../../users/users.service';
import { CertificatesService } from '../../certificates/certificates.service';
import { DevicesService } from '../../devices/devices.service';
import { SessionsService } from '../../sessions/sessions.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../audit/interfaces/audit.interface';
import { Role } from '../../permissions/constants/roles.enum';
import {
  APP_CONSTANTS,
  INJECTION_TOKENS,
} from '../../../shared/constants/app.constants';

const userId = new Types.ObjectId();
const PASSWORD = 'CorrectHorse!1';

/** Low cost factor: the production value (12) makes the suite crawl. */
const hashFor = (plain: string) => bcrypt.hashSync(plain, 4);

const buildUser = (overrides: Record<string, unknown> = {}) => ({
  _id: userId,
  uuid: 'user-uuid',
  email: 'user@company.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: Role.EMPLOYEE,
  passwordHash: hashFor(PASSWORD),
  isActive: true,
  mustChangePassword: false,
  isFirstLogin: false,
  ...overrides,
});

/** Audit rows recorded with a given action. */
const rowsFor = (auditService: { log: jest.Mock }, action: AuditAction) =>
  auditService.log.mock.calls
    .map(
      ([event]) =>
        event as { action: AuditAction; metadata?: any; status?: string },
    )
    .filter((event) => event.action === action);

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    findById: jest.Mock;
    isAccountLocked: jest.Mock;
    recordLoginAttempt: jest.Mock;
    updatePassword: jest.Mock;
  };
  let sessionsService: {
    createSession: jest.Mock;
    endAllUserSessions: jest.Mock;
  };
  let auditService: { log: jest.Mock };
  let refreshTokenModel: {
    findOne: jest.Mock;
    create: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
  };
  let redis: { setex: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      isAccountLocked: jest.fn().mockResolvedValue(false),
      recordLoginAttempt: jest.fn().mockResolvedValue(undefined),
      updatePassword: jest.fn().mockResolvedValue(undefined),
    };
    sessionsService = {
      createSession: jest
        .fn()
        .mockResolvedValue({ sessionId: 'session-uuid-1' }),
      endAllUserSessions: jest.fn().mockResolvedValue(undefined),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    refreshTokenModel = {
      findOne: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
    redis = {
      setex: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        {
          provide: CertificatesService,
          useValue: { verifyCertificate: jest.fn() },
        },
        { provide: DevicesService, useValue: { updateLastSeen: jest.fn() } },
        { provide: SessionsService, useValue: sessionsService },
        { provide: AuditService, useValue: auditService },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest
              .fn()
              .mockImplementation((payload: { type: string }) =>
                Promise.resolve(`${payload.type}-token`),
              ),
            decode: jest.fn().mockReturnValue({
              exp: Math.floor(Date.now() / 1000) + 900,
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              const values: Record<string, string> = {
                'jwt.accessSecret': 'access-secret',
                'jwt.refreshSecret': 'refresh-secret',
                'jwt.accessExpiration': '15m',
                'jwt.refreshExpiration': '7d',
              };
              return values[key] ?? fallback;
            }),
          },
        },
        {
          provide: getModelToken(RefreshTokenEntity.name),
          useValue: refreshTokenModel,
        },
        { provide: INJECTION_TOKENS.REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Password login: session + audit ─────────────────

  describe('login', () => {
    it('should create a password session and return its id', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());

      const result = await service.login(
        { email: 'user@company.com', password: PASSWORD },
        '10.0.0.1',
        'jest-agent',
      );

      expect(result.sessionId).toBe('session-uuid-1');
      expect(sessionsService.createSession).toHaveBeenCalledWith({
        userId: userId.toString(),
        deviceId: APP_CONSTANTS.PASSWORD_SESSION_DEVICE_ID,
        ipAddress: '10.0.0.1',
        userAgent: 'jest-agent',
        authMethod: 'password',
      });
    });

    it('should audit LOGIN_SUCCESS', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());

      await service.login(
        { email: 'user@company.com', password: PASSWORD },
        '10.0.0.1',
        'jest-agent',
      );

      const [row] = rowsFor(auditService, AuditAction.LOGIN_SUCCESS);
      expect(row).toBeDefined();
      expect(row.status).toBe('success');
      expect(row.metadata).toMatchObject({
        authMethod: 'password',
        sessionId: 'session-uuid-1',
      });
    });

    it.each([
      ['unknown_email', () => usersService.findByEmail.mockResolvedValue(null)],
      [
        'account_deactivated',
        () =>
          usersService.findByEmail.mockResolvedValue(
            buildUser({ isActive: false }),
          ),
      ],
      [
        'account_locked',
        () => {
          usersService.findByEmail.mockResolvedValue(buildUser());
          usersService.isAccountLocked.mockResolvedValue(true);
        },
      ],
    ])('should audit LOGIN_FAILURE with reason %s', async (reason, arrange) => {
      arrange();

      await expect(
        service.login(
          { email: 'user@company.com', password: PASSWORD },
          '10.0.0.1',
          'jest-agent',
        ),
      ).rejects.toThrow();

      const [row] = rowsFor(auditService, AuditAction.LOGIN_FAILURE);
      expect(row).toBeDefined();
      expect(row.status).toBe('failure');
      expect(row.metadata.reason).toBe(reason);
      expect(sessionsService.createSession).not.toHaveBeenCalled();
    });

    it('should audit LOGIN_FAILURE on a bad password without leaking the reason', async () => {
      usersService.findByEmail.mockResolvedValue(buildUser());

      const attempt = service.login(
        { email: 'user@company.com', password: 'wrong-password' },
        '10.0.0.1',
        'jest-agent',
      );

      await expect(attempt).rejects.toThrow(UnauthorizedException);
      // Response stays generic; the reason lives in the audit row only.
      await expect(attempt).rejects.toThrow('Invalid credentials');

      const [row] = rowsFor(auditService, AuditAction.LOGIN_FAILURE);
      expect(row.metadata.reason).toBe('invalid_password');
      expect(usersService.recordLoginAttempt).toHaveBeenCalledWith(
        userId.toString(),
        false,
        '10.0.0.1',
      );
    });

    it('should reject a deactivated account with 403', async () => {
      usersService.findByEmail.mockResolvedValue(
        buildUser({ isActive: false }),
      );

      await expect(
        service.login(
          { email: 'user@company.com', password: PASSWORD },
          '10.0.0.1',
          'jest-agent',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Refresh rotation and re-use detection ───────────

  describe('refreshTokens', () => {
    const storedToken = (overrides: Record<string, unknown> = {}) => ({
      _id: new Types.ObjectId(),
      userId,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 86400000),
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    it('should rotate the token and audit TOKEN_REFRESH', async () => {
      const token = storedToken();
      refreshTokenModel.findOne.mockResolvedValue(token);
      usersService.findById.mockResolvedValue(buildUser());

      const result = await service.refreshTokens(
        'refresh-token',
        '10.0.0.1',
        'jest-agent',
      );

      expect(result.accessToken).toBe('access-token');
      expect(token.isRevoked).toBe(true);
      expect(token.save).toHaveBeenCalled();
      expect(refreshTokenModel.create).toHaveBeenCalledTimes(1);

      const [row] = rowsFor(auditService, AuditAction.TOKEN_REFRESH);
      expect(row.status).toBe('success');
    });

    it('should look the token up without filtering on isRevoked', async () => {
      refreshTokenModel.findOne.mockResolvedValue(null);

      await expect(
        service.refreshTokens('refresh-token', '10.0.0.1', 'jest-agent'),
      ).rejects.toThrow(UnauthorizedException);

      // Filtering on isRevoked: false here would make re-use undetectable.
      const filter = refreshTokenModel.findOne.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(filter)).toEqual(['token']);
      expect(filter.token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should revoke every token for the user when a rotated token is replayed', async () => {
      refreshTokenModel.findOne.mockResolvedValue(
        storedToken({ isRevoked: true }),
      );
      refreshTokenModel.updateMany.mockResolvedValue({ modifiedCount: 3 });

      await expect(
        service.refreshTokens('refresh-token', '10.0.0.1', 'jest-agent'),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ isRevoked: false }),
        { isRevoked: true },
      );

      const [row] = rowsFor(auditService, AuditAction.SUSPICIOUS_ACTIVITY);
      expect(row).toBeDefined();
      expect(row.metadata).toMatchObject({
        event: 'refresh_token_reuse',
        revokedTokenCount: 3,
      });

      // No new tokens minted.
      expect(refreshTokenModel.create).not.toHaveBeenCalled();
    });

    it('should not reveal that a replayed token was recognised', async () => {
      refreshTokenModel.findOne.mockResolvedValue(
        storedToken({ isRevoked: true }),
      );
      const replay = service.refreshTokens('t', '10.0.0.1', 'jest-agent');
      await expect(replay).rejects.toThrow('Invalid or revoked refresh token');

      jest.clearAllMocks();
      refreshTokenModel.findOne.mockResolvedValue(null);
      const unknown = service.refreshTokens('t', '10.0.0.1', 'jest-agent');
      await expect(unknown).rejects.toThrow('Invalid or revoked refresh token');
    });

    it('should reject an expired token and audit the failure', async () => {
      refreshTokenModel.findOne.mockResolvedValue(
        storedToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.refreshTokens('refresh-token', '10.0.0.1', 'jest-agent'),
      ).rejects.toThrow(UnauthorizedException);

      const [row] = rowsFor(auditService, AuditAction.TOKEN_REFRESH);
      expect(row.status).toBe('failure');
      expect(row.metadata.reason).toBe('expired');
      expect(refreshTokenModel.create).not.toHaveBeenCalled();
    });

    it('should reject when the user is no longer active', async () => {
      refreshTokenModel.findOne.mockResolvedValue(storedToken());
      usersService.findById.mockResolvedValue(buildUser({ isActive: false }));

      await expect(
        service.refreshTokens('refresh-token', '10.0.0.1', 'jest-agent'),
      ).rejects.toThrow(UnauthorizedException);

      const [row] = rowsFor(auditService, AuditAction.TOKEN_REFRESH);
      expect(row.metadata.reason).toBe('user_inactive');
    });
  });

  // ─── Logout ──────────────────────────────────────────

  describe('logout', () => {
    it('should blacklist the access token, end sessions and audit LOGOUT', async () => {
      await service.logout(userId.toString(), 'access-token', 'refresh-token');

      expect(redis.setex).toHaveBeenCalled();
      expect(refreshTokenModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ token: expect.any(String) }),
        { isRevoked: true },
      );
      expect(sessionsService.endAllUserSessions).toHaveBeenCalledWith(
        userId.toString(),
      );

      const [row] = rowsFor(auditService, AuditAction.LOGOUT);
      expect(row).toBeDefined();
      expect(row.metadata).toMatchObject({ refreshTokenRevoked: true });
    });
  });

  // ─── forceChangePassword persists its refresh token ──

  describe('forceChangePassword', () => {
    it('should store the refresh token it hands back', async () => {
      const user = buildUser({
        mustChangePassword: true,
        passwordHash: hashFor('TempPass!1'),
      });
      usersService.findById.mockResolvedValue(user);

      const tokens = await service.forceChangePassword(
        userId.toString(),
        { temporaryPassword: 'TempPass!1', newPassword: 'BrandNew!2' },
        '10.0.0.1',
        'jest-agent',
      );

      expect(tokens.refreshToken).toBe('refresh-token');
      // Without this row, /auth/refresh would reject the token it just issued.
      expect(refreshTokenModel.create).toHaveBeenCalledTimes(1);
      const created = refreshTokenModel.create.mock.calls[0][0] as {
        token: string;
        userId: string;
      };
      expect(created.token).toMatch(/^[0-9a-f]{64}$/);
      expect(created.userId).toBe(userId.toString());

      expect(
        rowsFor(auditService, AuditAction.FORCE_PASSWORD_CHANGE),
      ).toHaveLength(1);
    });
  });

  describe('changePassword', () => {
    it('should revoke all refresh tokens and audit PASSWORD_CHANGE', async () => {
      usersService.findById.mockResolvedValue(buildUser());

      await service.changePassword(userId.toString(), {
        currentPassword: PASSWORD,
        newPassword: 'BrandNew!2',
      });

      expect(refreshTokenModel.updateMany).toHaveBeenCalledWith(
        { userId },
        { isRevoked: true },
      );
      expect(rowsFor(auditService, AuditAction.PASSWORD_CHANGE)).toHaveLength(
        1,
      );
    });
  });

  it('should report the correct HTTP status for auth rejections', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.login(
        { email: 'nobody@company.com', password: PASSWORD },
        '10.0.0.1',
        'jest-agent',
      ),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
  });
});
