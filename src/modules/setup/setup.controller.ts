import {
  Controller, Post, Body, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as express from 'express';
import { SetupService } from './setup.service';
import { CertificatesService } from '../certificates/certificates.service';
import {
  EnrollDeviceDto, VerifyTokenDto, GenerateCertificateDto, RenewCertificateDto,
} from './dto/setup.dto';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SetupApp API controller.
 * These endpoints are used exclusively by the SetupApp for device onboarding.
 * All setup endpoints are public (no JWT required) — they use enrollment tokens instead.
 */
@ApiTags('Setup')
@Controller('setup')
export class SetupController {
  constructor(
    private readonly setupService: SetupService,
    private readonly certificatesService: CertificatesService,
  ) {}

  /**
   * POST /setup/verify-token
   * Verify enrollment token validity before starting the enrollment flow.
   */
  @Public()
  @Post('verify-token')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify enrollment token',
    description: 'Validates an enrollment token before starting device enrollment. ' +
      'Checks token expiry, usage limits, and employee binding.',
  })
  @SwaggerResponse({ status: 200, description: 'Token verification result' })
  @SwaggerResponse({ status: 429, description: 'Rate limit exceeded' })
  async verifyToken(@Body() dto: VerifyTokenDto) {
    return this.setupService.verifyToken(dto);
  }

  /**
   * POST /setup/enroll
   * Full device enrollment: validate token → register device → sign CSR → return certificate.
   */
  @Public()
  @Post('enroll')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Enroll a new device',
    description: 'Complete device enrollment flow used by SetupApp. ' +
      'Validates enrollment token, registers device, signs CSR via Vault PKI, ' +
      'and returns the signed X.509 certificate.',
  })
  @SwaggerResponse({ status: 201, description: 'Device enrolled and certificate issued' })
  @SwaggerResponse({ status: 400, description: 'Invalid CSR or device fingerprint' })
  @SwaggerResponse({ status: 401, description: 'Invalid or expired enrollment token' })
  @SwaggerResponse({ status: 409, description: 'Device already enrolled' })
  async enroll(
    @Body() dto: EnrollDeviceDto,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return this.setupService.enrollDevice(dto, ip);
  }

  /**
   * POST /setup/generate-certificate
   * Generate a certificate from a CSR (admin-triggered, not part of normal enrollment).
   */
  @Public()
  @Post('generate-certificate')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generate certificate from CSR',
    description: 'Signs a CSR and returns the signed certificate. ' +
      'Used for manual certificate generation outside the standard enrollment flow.',
  })
  @SwaggerResponse({ status: 201, description: 'Certificate generated' })
  @SwaggerResponse({ status: 400, description: 'Invalid CSR format' })
  async generateCertificate(@Body() dto: GenerateCertificateDto) {
    return this.certificatesService.signAndStoreCertificate({
      csr: dto.csr,
      userId: 'system',
      employeeId: dto.employeeId,
      deviceId: dto.deviceId,
      deviceFingerprint: dto.deviceFingerprint,
      ttl: dto.ttl,
    });
  }

  /**
   * POST /setup/renew-certificate
   * Renew an existing certificate before it expires.
   */
  @Public()
  @Post('renew-certificate')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renew an existing certificate',
    description: 'Validates the current certificate, revokes it, and issues a new one. ' +
      'The device fingerprint must match the original enrollment.',
  })
  @SwaggerResponse({ status: 200, description: 'Certificate renewed successfully' })
  @SwaggerResponse({ status: 401, description: 'Current certificate is invalid or revoked' })
  async renewCertificate(
    @Body() dto: RenewCertificateDto,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return this.setupService.renewCertificate(dto, ip);
  }
}
