import {
  Injectable, Logger, UnauthorizedException, ForbiddenException, Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { UsersService } from '../users/users.service';
import { CertificatesService } from '../certificates/certificates.service';
import { DevicesService } from '../devices/devices.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/interfaces/audit.interface';
import { RefreshTokenEntity, RefreshTokenDocument } from '../users/schemas/refresh-token.schema';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { LoginDto } from './dto/login.dto';
import { CertificateLoginDto } from '../certificates/dto/certificate.dto';
import { ChangePasswordDto, ForceChangePasswordDto } from './dto/change-password.dto';
import { APP_CONSTANTS } from '../../shared/constants/app.constants';
import { CryptoUtil } from '../../shared/utils/crypto.util';
import { INJECTION_TOKENS } from '../../shared/constants/app.constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly certificatesService: CertificatesService,
    private readonly devicesService: DevicesService,
    private readonly sessionsService: SessionsService,
    private readonly auditService: AuditService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectModel(RefreshTokenEntity.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
    @Inject(INJECTION_TOKENS.REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  // ─── Password-Based Login ──────────────────────────────

  /**
   * Authenticate user with email and password.
   * Returns JWT access + refresh tokens.
   */
  async login(dto: LoginDto, ip: string, userAgent: string) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated. Contact your administrator.');
    }

    // Check account lockout
    if (await this.usersService.isAccountLocked(user)) {
      throw new ForbiddenException(
        'Account is temporarily locked due to multiple failed login attempts. Try again later.',
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      await this.usersService.recordLoginAttempt(user._id.toString(), false, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Record successful login
    await this.usersService.recordLoginAttempt(user._id.toString(), true, ip);

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Store refresh token
    await this.storeRefreshToken(
      tokens.refreshToken,
      user._id.toString(),
      userAgent,
      ip,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user._id,
        uuid: user.uuid,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        isFirstLogin: user.isFirstLogin,
      },
    };
  }

  // ─── Certificate-Based Login (Passwordless) ──────────────

  /**
   * Authenticate via X.509 certificate (passwordless login).
   * Used by the Main SecureVault App.
   *
   * Flow:
   * 1. Verify certificate (chain, expiry, revocation, fingerprint, device trust)
   * 2. Extract user from certificate metadata
   * 3. Issue JWT tokens
   * 4. Create session
   * 5. Log audit event
   */
  async certificateLogin(dto: CertificateLoginDto, ip: string, userAgent: string) {
    // 1. Verify the presented certificate
    const verification = await this.certificatesService.verifyCertificate(
      dto.certificate,
      dto.deviceFingerprint,
    );

    if (!verification.valid) {
      // Log failed certificate login attempt
      await this.auditService.log({
        action: AuditAction.CERT_LOGIN_FAILURE,
        resource: 'auth',
        ipAddress: ip,
        userAgent,
        metadata: {
          serialNumber: verification.serialNumber,
          deviceFingerprint: dto.deviceFingerprint,
          reason: verification.reason,
        },
        status: 'failure',
      });

      // Log suspicious activity for specific failure types
      if (verification.reason?.includes('revoked')) {
        await this.auditService.log({
          action: AuditAction.REVOKED_CERT_LOGIN,
          resource: 'security',
          ipAddress: ip,
          metadata: {
            serialNumber: verification.serialNumber,
            deviceFingerprint: dto.deviceFingerprint,
          },
          status: 'failure',
        });
      }

      if (verification.reason?.includes('fingerprint mismatch')) {
        await this.auditService.log({
          action: AuditAction.FINGERPRINT_MISMATCH,
          resource: 'security',
          ipAddress: ip,
          metadata: {
            serialNumber: verification.serialNumber,
            presentedFingerprint: dto.deviceFingerprint,
          },
          status: 'failure',
        });
      }

      throw new UnauthorizedException(`Certificate authentication failed: ${verification.reason}`);
    }

    // 2. Get user from certificate metadata
    const user = await this.usersService.findById(verification.userId);
    if (!user) {
      throw new UnauthorizedException('User associated with certificate not found');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    // 3. Generate JWT tokens
    const tokens = await this.generateTokens(user);

    // Store refresh token
    await this.storeRefreshToken(
      tokens.refreshToken,
      user._id.toString(),
      userAgent,
      ip,
    );

    // 4. Create session
    const session = await this.sessionsService.createSession({
      userId: user._id.toString(),
      deviceId: verification.deviceId,
      certificateSerial: verification.serialNumber,
      ipAddress: ip,
      userAgent,
      authMethod: 'certificate',
    });

    // 5. Update device last seen
    await this.devicesService.updateLastSeen(verification.deviceId, ip);

    // 6. Audit log
    await this.auditService.log({
      action: AuditAction.CERT_LOGIN_SUCCESS,
      resource: 'auth',
      userId: user._id.toString(),
      userEmail: user.email,
      userRole: user.role,
      ipAddress: ip,
      userAgent,
      metadata: {
        certificateSerial: verification.serialNumber,
        deviceId: verification.deviceId,
        employeeId: verification.employeeId,
        sessionId: session.sessionId,
        authMethod: 'certificate',
      },
      status: 'success',
    });

    this.logger.log(
      `✅ Certificate login: ${user.email} (device: ${verification.deviceId}, cert: ${verification.serialNumber})`,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: session.sessionId,
      user: {
        id: user._id,
        uuid: user.uuid,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      device: {
        deviceId: verification.deviceId,
        employeeId: verification.employeeId,
      },
      certificate: {
        serialNumber: verification.serialNumber,
      },
    };
  }

  // ─── Token Management ────────────────────────────────────

  /**
   * Refresh access token using a valid refresh token.
   * Implements token rotation — old refresh token is revoked, new one issued.
   */
  async refreshTokens(refreshToken: string, ip: string, userAgent: string) {
    // Find the stored refresh token (hash before lookup)
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const storedToken = await this.refreshTokenModel.findOne({
      token: tokenHash,
      isRevoked: false,
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid or revoked refresh token');
    }

    if (new Date() > storedToken.expiresAt) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke the old refresh token (rotation)
    storedToken.isRevoked = true;
    await storedToken.save();

    // Get user and generate new tokens
    const user = await this.usersService.findById(storedToken.userId.toString());
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const tokens = await this.generateTokens(user);

    // Store new refresh token
    await this.storeRefreshToken(tokens.refreshToken, user._id.toString(), userAgent, ip);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Logout — revoke refresh token and blacklist access token.
   */
  async logout(userId: string, accessToken: string, refreshToken?: string): Promise<void> {
    // Blacklist the access token in Redis
    if (accessToken) {
      try {
        const decoded = this.jwtService.decode(accessToken) as JwtPayload;
        if (decoded?.exp) {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            await this.redis.setex(
              `${APP_CONSTANTS.TOKEN_BLACKLIST_PREFIX}${accessToken}`,
              ttl,
              '1',
            );
          }
        }
      } catch { /* token already expired */ }
    }

    // Revoke the refresh token
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await this.refreshTokenModel.updateOne(
        { token: tokenHash },
        { isRevoked: true },
      );
    }

    // End active sessions
    await this.sessionsService.endAllUserSessions(userId);

    this.logger.log(`User logged out: ${userId}`);
  }

  // ─── Password Management ──────────────────────────────────

  /**
   * Change password for authenticated user.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    const isCurrentValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(dto.newPassword, APP_CONSTANTS.BCRYPT_SALT_ROUNDS);
    await this.usersService.updatePassword(userId, newHash);

    // Revoke all refresh tokens (force re-login on all devices)
    await this.refreshTokenModel.updateMany({ userId: user._id }, { isRevoked: true });

    this.logger.log(`Password changed for user: ${user.email}`);
  }

  /**
   * Force change password on first login.
   */
  async forceChangePassword(userId: string, dto: ForceChangePasswordDto): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    if (!user.mustChangePassword) {
      throw new ForbiddenException('Password change is not required');
    }

    // Verify temp password
    const isTempValid = await bcrypt.compare(dto.temporaryPassword, user.passwordHash);
    if (!isTempValid) {
      throw new UnauthorizedException('Temporary password is incorrect');
    }

    const newHash = await bcrypt.hash(dto.newPassword, APP_CONSTANTS.BCRYPT_SALT_ROUNDS);
    await this.usersService.updatePassword(userId, newHash);

    // Revoke all old tokens
    await this.refreshTokenModel.updateMany({ userId: user._id }, { isRevoked: true });

    // Reload user and generate fresh tokens
    const updatedUser = await this.usersService.findById(userId);
    return this.generateTokens(updatedUser!);
  }

  /**
   * Check if an access token is blacklisted.
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await this.redis.get(`${APP_CONSTANTS.TOKEN_BLACKLIST_PREFIX}${token}`);
    return result !== null;
  }

  // ─── Private Helpers ──────────────────────────────────────

  private async generateTokens(user: any): Promise<{ accessToken: string; refreshToken: string }> {
    const accessPayload: JwtPayload = {
      sub: user._id.toString(),
      uuid: user.uuid,
      email: user.email,
      role: user.role,
      type: 'access',
    };

    const refreshPayload: JwtPayload = {
      sub: user._id.toString(),
      uuid: user.uuid,
      email: user.email,
      role: user.role,
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.get<string>('jwt.accessSecret')!,
        expiresIn: this.configService.get<string>('jwt.accessExpiration')! as any,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('jwt.refreshSecret')!,
        expiresIn: this.configService.get<string>('jwt.refreshExpiration')! as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(
    token: string, userId: string, deviceInfo: string, ipAddress: string,
  ): Promise<void> {
    const expiresIn = this.configService.get<string>('jwt.refreshExpiration', '7d');
    const ms = this.parseExpiration(expiresIn);

    // Hash the token before storing (never store raw JWTs)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await this.refreshTokenModel.create({
      token: tokenHash,
      userId,
      deviceInfo,
      ipAddress,
      expiresAt: new Date(Date.now() + ms),
    });
  }

  private parseExpiration(exp: string): number {
    const match = exp.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000, m: 60000, h: 3600000, d: 86400000,
    };
    return value * (multipliers[unit] || 86400000);
  }
}
