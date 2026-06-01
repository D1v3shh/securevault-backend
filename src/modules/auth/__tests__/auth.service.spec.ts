import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { CertificatesService } from '../../certificates/certificates.service';
import { DevicesService } from '../../devices/devices.service';
import { SessionsService } from '../../sessions/sessions.service';
import { AuditService } from '../../audit/audit.service';
import { RefreshTokenEntity } from '../../users/schemas/refresh-token.schema';
import { INJECTION_TOKENS } from '../../../shared/constants/app.constants';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Partial<UsersService>>;
  let certificatesService: jest.Mocked<Partial<CertificatesService>>;
  let devicesService: jest.Mocked<Partial<DevicesService>>;
  let sessionsService: jest.Mocked<Partial<SessionsService>>;
  let auditService: jest.Mocked<Partial<AuditService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let refreshTokenModel: any;
  let redisClient: any;

  const mockUser = {
    _id: { toString: () => 'user-id-123' },
    uuid: 'uuid-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'EMPLOYEE',
    passwordHash: 'hashed-password',
    isActive: true,
    mustChangePassword: false,
    isFirstLogin: false,
  };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      isAccountLocked: jest.fn(),
      recordLoginAttempt: jest.fn(),
      updatePassword: jest.fn(),
    };

    certificatesService = {
      verifyCertificate: jest.fn(),
    };

    devicesService = {
      updateLastSeen: jest.fn(),
    };

    sessionsService = {
      createSession: jest.fn(),
      endAllUserSessions: jest.fn(),
    };

    auditService = {
      log: jest.fn(),
    };

    jwtService = {
      signAsync: jest.fn(),
      decode: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string, defaultVal?: any) => {
        const map: Record<string, string> = {
          'jwt.accessSecret': 'test-access-secret',
          'jwt.refreshSecret': 'test-refresh-secret',
          'jwt.accessExpiration': '15m',
          'jwt.refreshExpiration': '7d',
        };
        return map[key] || defaultVal || null;
      }),
    };

    refreshTokenModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
    };

    redisClient = {
      setex: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: CertificatesService, useValue: certificatesService },
        { provide: DevicesService, useValue: devicesService },
        { provide: SessionsService, useValue: sessionsService },
        { provide: AuditService, useValue: auditService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: getModelToken(RefreshTokenEntity.name), useValue: refreshTokenModel },
        { provide: INJECTION_TOKENS.REDIS_CLIENT, useValue: redisClient },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Password Login ─────────────────────────────────────

  describe('login', () => {
    const loginDto = { email: 'test@example.com', password: 'password123' };
    const ip = '127.0.0.1';
    const userAgent = 'TestAgent/1.0';

    it('should login successfully with valid credentials', async () => {
      usersService.findByEmail!.mockResolvedValue(mockUser as any);
      usersService.isAccountLocked!.mockResolvedValue(false);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      usersService.recordLoginAttempt!.mockResolvedValue(undefined);
      jwtService.signAsync!.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');

      const result = await service.login(loginDto, ip, userAgent);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.role).toBe('EMPLOYEE');
      expect(usersService.recordLoginAttempt).toHaveBeenCalledWith('user-id-123', true, ip);
      expect(refreshTokenModel.create).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when user not found', async () => {
      usersService.findByEmail!.mockResolvedValue(null);

      await expect(service.login(loginDto, ip, userAgent))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException when user is deactivated', async () => {
      usersService.findByEmail!.mockResolvedValue({ ...mockUser, isActive: false } as any);

      await expect(service.login(loginDto, ip, userAgent))
        .rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when account is locked', async () => {
      usersService.findByEmail!.mockResolvedValue(mockUser as any);
      usersService.isAccountLocked!.mockResolvedValue(true);

      await expect(service.login(loginDto, ip, userAgent))
        .rejects.toThrow(ForbiddenException);
    });

    it('should throw UnauthorizedException on invalid password', async () => {
      usersService.findByEmail!.mockResolvedValue(mockUser as any);
      usersService.isAccountLocked!.mockResolvedValue(false);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto, ip, userAgent))
        .rejects.toThrow(UnauthorizedException);
      expect(usersService.recordLoginAttempt).toHaveBeenCalledWith('user-id-123', false, ip);
    });

    it('should return mustChangePassword and isFirstLogin flags', async () => {
      const firstLoginUser = { ...mockUser, mustChangePassword: true, isFirstLogin: true };
      usersService.findByEmail!.mockResolvedValue(firstLoginUser as any);
      usersService.isAccountLocked!.mockResolvedValue(false);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.signAsync!.mockResolvedValueOnce('at').mockResolvedValueOnce('rt');

      const result = await service.login(loginDto, ip, userAgent);

      expect(result.user.mustChangePassword).toBe(true);
      expect(result.user.isFirstLogin).toBe(true);
    });
  });

  // ─── Certificate Login ──────────────────────────────────

  describe('certificateLogin', () => {
    const dto = { certificate: 'PEM-DATA', deviceFingerprint: 'fp-123' };
    const ip = '10.0.0.1';
    const userAgent = 'SecureVaultApp/1.0';

    it('should login successfully with valid certificate', async () => {
      certificatesService.verifyCertificate!.mockResolvedValue({
        valid: true,
        serialNumber: 'SN123',
        employeeId: 'EMP001',
        deviceId: 'DEV001',
        userId: 'user-id-123',
      });
      usersService.findById!.mockResolvedValue(mockUser as any);
      jwtService.signAsync!.mockResolvedValueOnce('cert-at').mockResolvedValueOnce('cert-rt');
      sessionsService.createSession!.mockResolvedValue({ sessionId: 'session-1' } as any);

      const result = await service.certificateLogin(dto, ip, userAgent);

      expect(result.accessToken).toBe('cert-at');
      expect(result.sessionId).toBe('session-1');
      expect(result.device.deviceId).toBe('DEV001');
      expect(result.certificate.serialNumber).toBe('SN123');
      expect(devicesService.updateLastSeen).toHaveBeenCalledWith('DEV001', ip);
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw and audit log on invalid certificate', async () => {
      certificatesService.verifyCertificate!.mockResolvedValue({
        valid: false,
        serialNumber: 'SN123',
        employeeId: '',
        deviceId: '',
        userId: '',
        reason: 'Certificate has expired',
      });

      await expect(service.certificateLogin(dto, ip, userAgent))
        .rejects.toThrow(UnauthorizedException);
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should audit revoked certificate login attempts', async () => {
      certificatesService.verifyCertificate!.mockResolvedValue({
        valid: false,
        serialNumber: 'SN123',
        employeeId: '',
        deviceId: '',
        userId: '',
        reason: 'Certificate has been revoked',
      });

      await expect(service.certificateLogin(dto, ip, userAgent))
        .rejects.toThrow(UnauthorizedException);
      // Two audit logs: general failure + revoked cert specific
      expect(auditService.log).toHaveBeenCalledTimes(2);
    });

    it('should audit fingerprint mismatch attempts', async () => {
      certificatesService.verifyCertificate!.mockResolvedValue({
        valid: false,
        serialNumber: 'SN123',
        employeeId: '',
        deviceId: '',
        userId: '',
        reason: 'Device fingerprint mismatch',
      });

      await expect(service.certificateLogin(dto, ip, userAgent))
        .rejects.toThrow(UnauthorizedException);
      expect(auditService.log).toHaveBeenCalledTimes(2);
    });

    it('should throw when user not found for valid cert', async () => {
      certificatesService.verifyCertificate!.mockResolvedValue({
        valid: true, serialNumber: 'SN1', employeeId: 'E1', deviceId: 'D1', userId: 'no-user',
      });
      usersService.findById!.mockResolvedValue(null);

      await expect(service.certificateLogin(dto, ip, userAgent))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw when user is inactive for valid cert', async () => {
      certificatesService.verifyCertificate!.mockResolvedValue({
        valid: true, serialNumber: 'SN1', employeeId: 'E1', deviceId: 'D1', userId: 'user-id-123',
      });
      usersService.findById!.mockResolvedValue({ ...mockUser, isActive: false } as any);

      await expect(service.certificateLogin(dto, ip, userAgent))
        .rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Token Refresh ──────────────────────────────────────

  describe('refreshTokens', () => {
    it('should refresh tokens with valid refresh token', async () => {
      const storedToken = {
        token: crypto.createHash('sha256').update('valid-rt').digest('hex'),
        userId: { toString: () => 'user-id-123' },
        isRevoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        save: jest.fn(),
      };
      refreshTokenModel.findOne.mockResolvedValue(storedToken);
      usersService.findById!.mockResolvedValue(mockUser as any);
      jwtService.signAsync!.mockResolvedValueOnce('new-at').mockResolvedValueOnce('new-rt');

      const result = await service.refreshTokens('valid-rt', '127.0.0.1', 'Agent');

      expect(result.accessToken).toBe('new-at');
      expect(result.refreshToken).toBe('new-rt');
      expect(storedToken.isRevoked).toBe(true);
      expect(storedToken.save).toHaveBeenCalled();
    });

    it('should throw when refresh token not found', async () => {
      refreshTokenModel.findOne.mockResolvedValue(null);

      await expect(service.refreshTokens('bad-rt', '127.0.0.1', 'Agent'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw when refresh token expired', async () => {
      refreshTokenModel.findOne.mockResolvedValue({
        expiresAt: new Date(Date.now() - 1000),
        isRevoked: false,
        save: jest.fn(),
      });

      await expect(service.refreshTokens('expired-rt', '127.0.0.1', 'Agent'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw when user not found after token rotation', async () => {
      refreshTokenModel.findOne.mockResolvedValue({
        userId: { toString: () => 'deleted-user' },
        isRevoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        save: jest.fn(),
      });
      usersService.findById!.mockResolvedValue(null);

      await expect(service.refreshTokens('rt', '127.0.0.1', 'Agent'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw when user is inactive after token rotation', async () => {
      refreshTokenModel.findOne.mockResolvedValue({
        userId: { toString: () => 'user-id-123' },
        isRevoked: false,
        expiresAt: new Date(Date.now() + 86400000),
        save: jest.fn(),
      });
      usersService.findById!.mockResolvedValue({ ...mockUser, isActive: false } as any);

      await expect(service.refreshTokens('rt', '127.0.0.1', 'Agent'))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Logout ────────────────────────────────────────────

  describe('logout', () => {
    it('should blacklist access token and revoke refresh token', async () => {
      jwtService.decode!.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 900 });

      await service.logout('user-id-123', 'access-token-value', 'refresh-token-value');

      expect(redisClient.setex).toHaveBeenCalled();
      expect(refreshTokenModel.updateOne).toHaveBeenCalled();
      expect(sessionsService.endAllUserSessions).toHaveBeenCalledWith('user-id-123');
    });

    it('should handle expired access token gracefully', async () => {
      jwtService.decode!.mockReturnValue({ exp: Math.floor(Date.now() / 1000) - 100 });

      await service.logout('user-id-123', 'expired-at', 'rt');

      // Should NOT call setex for expired tokens
      expect(redisClient.setex).not.toHaveBeenCalled();
      expect(sessionsService.endAllUserSessions).toHaveBeenCalled();
    });

    it('should handle missing refresh token', async () => {
      jwtService.decode!.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 900 });

      await service.logout('user-id-123', 'at');

      expect(refreshTokenModel.updateOne).not.toHaveBeenCalled();
    });

    it('should handle decode failure gracefully', async () => {
      jwtService.decode!.mockImplementation(() => { throw new Error('bad token'); });

      // Should not throw
      await service.logout('user-id-123', 'bad-token', 'rt');

      expect(sessionsService.endAllUserSessions).toHaveBeenCalled();
    });
  });

  // ─── Password Change ──────────────────────────────────

  describe('changePassword', () => {
    const dto = { currentPassword: 'old-pass', newPassword: 'new-pass' };

    it('should change password successfully', async () => {
      usersService.findById!.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      await service.changePassword('user-id-123', dto);

      expect(usersService.updatePassword).toHaveBeenCalledWith('user-id-123', 'new-hash');
      expect(refreshTokenModel.updateMany).toHaveBeenCalled();
    });

    it('should throw when user not found', async () => {
      usersService.findById!.mockResolvedValue(null);

      await expect(service.changePassword('bad-id', dto))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw when current password is wrong', async () => {
      usersService.findById!.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.changePassword('user-id-123', dto))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Force Password Change ────────────────────────────

  describe('forceChangePassword', () => {
    const dto = { temporaryPassword: 'temp-pass', newPassword: 'new-pass' };

    it('should force change password and return new tokens', async () => {
      const firstLoginUser = { ...mockUser, mustChangePassword: true, _id: mockUser._id };
      usersService.findById!
        .mockResolvedValueOnce(firstLoginUser as any)
        .mockResolvedValueOnce({ ...firstLoginUser, mustChangePassword: false } as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      jwtService.signAsync!.mockResolvedValueOnce('new-at').mockResolvedValueOnce('new-rt');

      const result = await service.forceChangePassword('user-id-123', dto);

      expect(result.accessToken).toBe('new-at');
      expect(result.refreshToken).toBe('new-rt');
    });

    it('should throw when password change is not required', async () => {
      usersService.findById!.mockResolvedValue({ ...mockUser, mustChangePassword: false } as any);

      await expect(service.forceChangePassword('user-id-123', dto))
        .rejects.toThrow(ForbiddenException);
    });

    it('should throw when temporary password is wrong', async () => {
      usersService.findById!.mockResolvedValue({ ...mockUser, mustChangePassword: true } as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.forceChangePassword('user-id-123', dto))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Token Blacklist ──────────────────────────────────

  describe('isTokenBlacklisted', () => {
    it('should return true when token is blacklisted', async () => {
      redisClient.get.mockResolvedValue('1');

      expect(await service.isTokenBlacklisted('some-token')).toBe(true);
    });

    it('should return false when token is not blacklisted', async () => {
      redisClient.get.mockResolvedValue(null);

      expect(await service.isTokenBlacklisted('some-token')).toBe(false);
    });
  });
});
