import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { UsersService } from '../users/users.service';
import { CertificatesService } from '../certificates/certificates.service';
import { DevicesService } from '../devices/devices.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/interfaces/audit.interface';
import {
  RefreshTokenEntity,
  RefreshTokenDocument,
} from '../users/schemas/refresh-token.schema';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { LoginDto } from './dto/login.dto';
import { CertificateLoginDto } from '../certificates/dto/certificate.dto';
import {
  ChangePasswordDto,
  ForceChangePasswordDto,
} from './dto/change-password.dto';
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
      await this.logLoginFailure(ip, userAgent, 'unknown_email', {
        email: dto.email,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      await this.logLoginFailure(ip, userAgent, 'account_deactivated', {
        email: user.email,
        userId: user._id.toString(),
      });
      throw new ForbiddenException(
        'Account is deactivated. Contact your administrator.',
      );
    }

    // Check account lockout
    if (await this.usersService.isAccountLocked(user)) {
      await this.logLoginFailure(ip, userAgent, 'account_locked', {
        email: user.email,
        userId: user._id.toString(),
      });
      throw new ForbiddenException(
        'Account is temporarily locked due to multiple failed login attempts. Try again later.',
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      await this.usersService.recordLoginAttempt(
        user._id.toString(),
        false,
        ip,
      );
      await this.logLoginFailure(ip, userAgent, 'invalid_password', {
        email: user.email,
        userId: user._id.toString(),
      });
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

    // Create a session so password logins are visible to the sessions
    // collection. Without this, logout's endAllUserSessions matched nothing for
    // password users and the row was never written.
    const session = await this.sessionsService.createSession({
      userId: user._id.toString(),
      deviceId: APP_CONSTANTS.PASSWORD_SESSION_DEVICE_ID,
      ipAddress: ip,
      userAgent,
      authMethod: 'password',
    });

    await this.auditService.log({
      action: AuditAction.LOGIN_SUCCESS,
      resource: 'auth',
      userId: user._id.toString(),
      userEmail: user.email,
      userRole: user.role,
      ipAddress: ip,
      userAgent,
      metadata: {
        authMethod: 'password',
        sessionId: session.sessionId,
        mustChangePassword: user.mustChangePassword,
      },
      status: 'success',
    });

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
  async certificateLogin(
    dto: CertificateLoginDto,
    ip: string,
    userAgent: string,
  ) {
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

      throw new UnauthorizedException(
        `Certificate authentication failed: ${verification.reason}`,
      );
    }

    // 2. Get user from certificate metadata
    const user = await this.usersService.findById(verification.userId);
    if (!user) {
      throw new UnauthorizedException(
        'User associated with certificate not found',
      );
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
    // Find the stored refresh token (hash before lookup).
    // Revoked rows are fetched too, so re-use of an already-rotated token is
    // detectable rather than indistinguishable from an unknown token.
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');
    const storedToken = await this.refreshTokenModel.findOne({
      token: tokenHash,
    });

    if (!storedToken) {
      await this.logRefreshFailure(ip, userAgent, 'unknown_token');
      throw new UnauthorizedException('Invalid or revoked refresh token');
    }

    // ─── Re-use detection ──────────────────────────────
    // This token was already exchanged. Either the legitimate holder replayed
    // it, or it leaked and someone else rotated it first. We cannot tell which,
    // so treat the whole chain as compromised and revoke every token for the
    // user, forcing a fresh login.
    if (storedToken.isRevoked) {
      const userId = storedToken.userId.toString();
      const revoked = await this.revokeAllRefreshTokens(userId);

      this.logger.warn(
        `Refresh token re-use detected for user ${userId} from ${ip} — ` +
          `revoked ${revoked} token(s)`,
      );

      await this.auditService.log({
        action: AuditAction.SUSPICIOUS_ACTIVITY,
        resource: 'auth',
        userId,
        ipAddress: ip,
        userAgent,
        metadata: {
          event: 'refresh_token_reuse',
          revokedTokenCount: revoked,
        },
        status: 'failure',
      });

      // Same message as an unknown token — do not reveal that the token was
      // recognised.
      throw new UnauthorizedException('Invalid or revoked refresh token');
    }

    if (new Date() > storedToken.expiresAt) {
      await this.logRefreshFailure(
        ip,
        userAgent,
        'expired',
        storedToken.userId.toString(),
      );
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke the old refresh token (rotation)
    storedToken.isRevoked = true;
    await storedToken.save();

    // Get user and generate new tokens
    const user = await this.usersService.findById(
      storedToken.userId.toString(),
    );
    if (!user || !user.isActive) {
      await this.logRefreshFailure(
        ip,
        userAgent,
        'user_inactive',
        storedToken.userId.toString(),
      );
      throw new UnauthorizedException('User not found or inactive');
    }

    const tokens = await this.generateTokens(user);

    // Store new refresh token
    await this.storeRefreshToken(
      tokens.refreshToken,
      user._id.toString(),
      userAgent,
      ip,
    );

    await this.auditService.log({
      action: AuditAction.TOKEN_REFRESH,
      resource: 'auth',
      userId: user._id.toString(),
      userEmail: user.email,
      userRole: user.role,
      ipAddress: ip,
      userAgent,
      metadata: { rotated: true },
      status: 'success',
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Logout — revoke refresh token and blacklist access token.
   */
  async logout(
    userId: string,
    accessToken: string,
    refreshToken?: string,
  ): Promise<void> {
    // Blacklist the access token in Redis
    if (accessToken) {
      try {
        const decoded = this.jwtService.decode(accessToken);
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
      } catch {
        /* token already expired */
      }
    }

    // Revoke the refresh token
    if (refreshToken) {
      const tokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      await this.refreshTokenModel.updateOne(
        { token: tokenHash },
        { isRevoked: true },
      );
    }

    // End active sessions
    await this.sessionsService.endAllUserSessions(userId);

    await this.auditService.log({
      action: AuditAction.LOGOUT,
      resource: 'auth',
      userId,
      metadata: { refreshTokenRevoked: Boolean(refreshToken) },
      status: 'success',
    });

    this.logger.log(`User logged out: ${userId}`);
  }

  // ─── Password Management ──────────────────────────────────

  /**
   * Change password for authenticated user.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    const isCurrentValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isCurrentValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(
      dto.newPassword,
      APP_CONSTANTS.BCRYPT_SALT_ROUNDS,
    );
    await this.usersService.updatePassword(userId, newHash);

    // Revoke all refresh tokens (force re-login on all devices)
    await this.refreshTokenModel.updateMany(
      { userId: user._id },
      { isRevoked: true },
    );

    await this.auditService.log({
      action: AuditAction.PASSWORD_CHANGE,
      resource: 'auth',
      userId,
      userEmail: user.email,
      userRole: user.role,
      metadata: { allRefreshTokensRevoked: true },
      status: 'success',
    });

    this.logger.log(`Password changed for user: ${user.email}`);
  }

  /**
   * Force change password on first login.
   */
  async forceChangePassword(
    userId: string,
    dto: ForceChangePasswordDto,
    ip = 'unknown',
    userAgent = 'unknown',
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    if (!user.mustChangePassword) {
      throw new ForbiddenException('Password change is not required');
    }

    // Verify temp password
    const isTempValid = await bcrypt.compare(
      dto.temporaryPassword,
      user.passwordHash,
    );
    if (!isTempValid) {
      throw new UnauthorizedException('Temporary password is incorrect');
    }

    const newHash = await bcrypt.hash(
      dto.newPassword,
      APP_CONSTANTS.BCRYPT_SALT_ROUNDS,
    );
    await this.usersService.updatePassword(userId, newHash);

    // Revoke all old tokens
    await this.refreshTokenModel.updateMany(
      { userId: user._id },
      { isRevoked: true },
    );

    // Reload user and generate fresh tokens
    const updatedUser = await this.usersService.findById(userId);
    const tokens = await this.generateTokens(updatedUser!);

    // The refresh token must be persisted, otherwise /auth/refresh rejects it:
    // the lookup is by stored hash, so a token with no row is indistinguishable
    // from an invalid one.
    await this.storeRefreshToken(tokens.refreshToken, userId, userAgent, ip);

    await this.auditService.log({
      action: AuditAction.FORCE_PASSWORD_CHANGE,
      resource: 'auth',
      userId,
      userEmail: updatedUser?.email,
      userRole: updatedUser?.role,
      ipAddress: ip,
      userAgent,
      metadata: { allPreviousTokensRevoked: true },
      status: 'success',
    });

    return tokens;
  }

  /**
   * Check if an access token is blacklisted.
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await this.redis.get(
      `${APP_CONSTANTS.TOKEN_BLACKLIST_PREFIX}${token}`,
    );
    return result !== null;
  }

  // ─── Private Helpers ──────────────────────────────────────

  /**
   * Record a failed password login. The reason is kept in metadata only — the
   * response itself stays deliberately generic to avoid account enumeration.
   */
  private async logLoginFailure(
    ip: string,
    userAgent: string,
    reason: string,
    context: { email?: string; userId?: string } = {},
  ): Promise<void> {
    await this.auditService.log({
      action: AuditAction.LOGIN_FAILURE,
      resource: 'auth',
      userId: context.userId,
      userEmail: context.email,
      ipAddress: ip,
      userAgent,
      metadata: { authMethod: 'password', reason },
      status: 'failure',
    });
  }

  /** Record a rejected token refresh. */
  private async logRefreshFailure(
    ip: string,
    userAgent: string,
    reason: string,
    userId?: string,
  ): Promise<void> {
    await this.auditService.log({
      action: AuditAction.TOKEN_REFRESH,
      resource: 'auth',
      userId,
      ipAddress: ip,
      userAgent,
      metadata: { reason },
      status: 'failure',
    });
  }

  /**
   * Revoke every outstanding refresh token for a user.
   * @returns the number of tokens revoked.
   */
  private async revokeAllRefreshTokens(userId: string): Promise<number> {
    const result = await this.refreshTokenModel.updateMany(
      { userId: new Types.ObjectId(userId), isRevoked: false },
      { isRevoked: true },
    );
    return result.modifiedCount ?? 0;
  }

  private async generateTokens(
    user: any,
  ): Promise<{ accessToken: string; refreshToken: string }> {
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
        expiresIn: this.configService.get<string>(
          'jwt.accessExpiration',
        )! as any,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('jwt.refreshSecret')!,
        expiresIn: this.configService.get<string>(
          'jwt.refreshExpiration',
        )! as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(
    token: string,
    userId: string,
    deviceInfo: string,
    ipAddress: string,
  ): Promise<void> {
    const expiresIn = this.configService.get<string>(
      'jwt.refreshExpiration',
      '7d',
    );
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
      s: 1000,
      m: 60000,
      h: 3600000,
      d: 86400000,
    };
    return value * (multipliers[unit] || 86400000);
  }
}
