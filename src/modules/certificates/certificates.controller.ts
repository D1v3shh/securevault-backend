import {
  Controller, Post, Get, Body, Param, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiResponse as SwaggerResponse, ApiParam,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as express from 'express';
import { CertificatesService } from './certificates.service';
import { VerifyCertificateDto, RevokeCertificateDto } from './dto/certificate.dto';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import * as JwtPayloadNs from '../auth/interfaces/jwt-payload.interface';
import { Role } from '../permissions/constants/roles.enum';

/**
 * Certificate management API controller.
 * Provides certificate verification, revocation, and status endpoints.
 */
@ApiTags('Certificates')
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  /**
   * POST /certificates/verify
   * Verify a certificate's validity (chain, expiry, revocation, fingerprint).
   */
  @Public()
  @Post('verify')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a certificate',
    description: 'Validates an X.509 certificate against the trust store. ' +
      'Checks certificate chain, expiry, revocation status, and device fingerprint binding.',
  })
  @SwaggerResponse({ status: 200, description: 'Certificate verification result' })
  async verify(@Body() dto: VerifyCertificateDto) {
    return this.certificatesService.verifyCertificate(
      dto.certificate,
      dto.deviceFingerprint,
    );
  }

  /**
   * POST /certificates/revoke
   * Revoke a certificate by serial number.
   */
  @Post('revoke')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Revoke a certificate',
    description: 'Revokes a certificate by serial number. This action is irreversible. ' +
      'The certificate will be added to the CRL and rejected on future verification attempts.',
  })
  @SwaggerResponse({ status: 200, description: 'Certificate revoked' })
  @SwaggerResponse({ status: 404, description: 'Certificate not found' })
  async revoke(
    @Body() dto: RevokeCertificateDto,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    await this.certificatesService.revokeCertificate(
      dto.serialNumber,
      user.userId,
      dto.reason,
      ip,
    );
    return { message: 'Certificate revoked successfully', serialNumber: dto.serialNumber };
  }

  /**
   * GET /certificates/:serial
   * Get certificate details by serial number.
   */
  @Get(':serial')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get certificate by serial number',
    description: 'Retrieves certificate metadata including validity period, status, and device binding.',
  })
  @ApiParam({ name: 'serial', description: 'Certificate serial number' })
  @SwaggerResponse({ status: 200, description: 'Certificate details' })
  @SwaggerResponse({ status: 404, description: 'Certificate not found' })
  async getBySerial(@Param('serial') serial: string) {
    const cert = await this.certificatesService.findBySerial(serial);
    if (!cert) {
      return { found: false, serialNumber: serial };
    }
    return {
      found: true,
      serialNumber: cert.serialNumber,
      employeeId: cert.employeeId,
      deviceId: cert.deviceId,
      status: cert.status,
      issuer: cert.issuer,
      subject: cert.subject,
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      fingerprint: cert.fingerprint,
      keyType: cert.keyType,
      keySize: cert.keySize,
      renewalCount: cert.renewalCount,
      createdAt: (cert as any).createdAt,
    };
  }

  /**
   * GET /certificates/status/:serial
   * Get certificate revocation/expiry status.
   */
  @Get('status/:serial')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get certificate status',
    description: 'Returns the current status of a certificate: active, expired, or revoked.',
  })
  @ApiParam({ name: 'serial', description: 'Certificate serial number' })
  @SwaggerResponse({ status: 200, description: 'Certificate status' })
  @SwaggerResponse({ status: 404, description: 'Certificate not found' })
  async getStatus(@Param('serial') serial: string) {
    return this.certificatesService.getStatus(serial);
  }
}
