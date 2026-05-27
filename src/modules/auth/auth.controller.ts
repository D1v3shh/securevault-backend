import {
  Controller, Post, Body, Req, HttpCode, HttpStatus, Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as express from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto, ForceChangePasswordDto } from './dto/change-password.dto';
import { CertificateLoginDto } from '../certificates/dto/certificate.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import * as JwtPayloadNs from './interfaces/jwt-payload.interface';

/**
 * Authentication controller.
 * Supports both password-based and certificate-based (passwordless) authentication.
 */
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── Password Auth ──────────────────────────────────

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with email and password',
    description: 'Authenticates user with email/password credentials. ' +
      'Returns JWT access and refresh tokens.',
  })
  @SwaggerResponse({ status: 200, description: 'Login successful' })
  @SwaggerResponse({ status: 401, description: 'Invalid credentials' })
  @SwaggerResponse({ status: 403, description: 'Account locked or deactivated' })
  async login(@Body() dto: LoginDto, @Req() req: express.Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.get('user-agent') || 'unknown';
    return this.authService.login(dto, ip, userAgent);
  }

  // ─── Certificate Auth (Passwordless) ──────────────────

  /**
   * POST /auth/certificate-login
   * Passwordless login using X.509 client certificate.
   * Used by the Main SecureVault App.
   */
  @Public()
  @Post('certificate-login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Passwordless login with X.509 certificate',
    description: 'Authenticates using an installed X.509 client certificate. ' +
      'Verifies certificate chain, expiry, revocation status, device fingerprint, ' +
      'and device approval status. Returns JWT tokens and session ID.',
  })
  @SwaggerResponse({ status: 200, description: 'Certificate login successful' })
  @SwaggerResponse({ status: 401, description: 'Certificate verification failed' })
  @SwaggerResponse({ status: 403, description: 'Account deactivated or device not approved' })
  async certificateLogin(
    @Body() dto: CertificateLoginDto,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.get('user-agent') || 'unknown';
    return this.authService.certificateLogin(dto, ip, userAgent);
  }

  // ─── Token Management ─────────────────────────────────

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Exchange a valid refresh token for new access and refresh tokens. ' +
      'Implements token rotation — the old refresh token is revoked.',
  })
  @SwaggerResponse({ status: 200, description: 'Tokens refreshed' })
  @SwaggerResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: express.Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.get('user-agent') || 'unknown';
    return this.authService.refreshTokens(dto.refreshToken, ip, userAgent);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Logout and revoke tokens',
    description: 'Revokes the refresh token, blacklists the access token, ' +
      'and ends all active sessions for the user.',
  })
  @SwaggerResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Headers('authorization') authHeader: string,
    @Body('refreshToken') refreshToken?: string,
  ) {
    const accessToken = authHeader?.replace('Bearer ', '') || '';
    await this.authService.logout(user.userId, accessToken, refreshToken);
    return { message: 'Logged out successfully' };
  }

  // ─── Password Management ──────────────────────────────

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Change password',
    description: 'Change the current user password. Requires current password verification. ' +
      'Revokes all refresh tokens (forces re-login on all devices).',
  })
  @SwaggerResponse({ status: 200, description: 'Password changed' })
  @SwaggerResponse({ status: 401, description: 'Current password incorrect' })
  async changePassword(
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user.userId, dto);
    return { message: 'Password changed successfully. Please login again.' };
  }

  @Post('force-change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Force change password on first login',
    description: 'Change temporary password after first login. ' +
      'Required when mustChangePassword is true.',
  })
  @SwaggerResponse({ status: 200, description: 'Password changed, new tokens issued' })
  async forceChangePassword(
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Body() dto: ForceChangePasswordDto,
  ) {
    const tokens = await this.authService.forceChangePassword(user.userId, dto);
    return {
      message: 'Password changed successfully',
      ...tokens,
    };
  }
}
