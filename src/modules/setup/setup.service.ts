import {
  Injectable, Logger, BadRequestException, UnauthorizedException,
  ConflictException, NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { EnrollmentTokenEntity, EnrollmentTokenDocument } from './schemas/enrollment-token.schema';
import { DevicesService } from '../devices/devices.service';
import { CertificatesService } from '../certificates/certificates.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/interfaces/audit.interface';
import { EnrollDeviceDto, VerifyTokenDto, RenewCertificateDto } from './dto/setup.dto';
import { CertificateUtil } from '../../shared/utils/certificate.util';
import { DeviceStatus } from '../devices/schemas/device.schema';

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    @InjectModel(EnrollmentTokenEntity.name)
    private readonly enrollmentTokenModel: Model<EnrollmentTokenDocument>,
    private readonly devicesService: DevicesService,
    private readonly certificatesService: CertificatesService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create an enrollment token for an employee.
   * Called by admin to initiate device onboarding.
   */
  async createEnrollmentToken(params: {
    userId: string;
    employeeId: string;
    expiresInHours?: number;
    maxDevices?: number;
    createdBy: string;
    ipAddress?: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    // Verify user exists
    const user = await this.usersService.findById(params.userId);
    if (!user) throw new NotFoundException('User not found');

    // Generate secure token
    const tokenValue = `enr_${crypto.randomBytes(32).toString('hex')}`;
    const expiresInHours = params.expiresInHours || 24;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    await this.enrollmentTokenModel.create({
      token: tokenValue,
      userId: new Types.ObjectId(params.userId),
      employeeId: params.employeeId,
      expiresAt,
      maxDevices: params.maxDevices || 1,
      createdBy: params.createdBy,
    });

    await this.auditService.log({
      action: AuditAction.ENROLLMENT_TOKEN_CREATE,
      resource: 'enrollment_token',
      userId: params.createdBy,
      ipAddress: params.ipAddress,
      metadata: {
        targetUserId: params.userId,
        employeeId: params.employeeId,
        expiresAt: expiresAt.toISOString(),
        maxDevices: params.maxDevices || 1,
      },
      status: 'success',
    });

    this.logger.log(
      `Enrollment token created for employee ${params.employeeId} (expires: ${expiresAt.toISOString()})`,
    );

    return { token: tokenValue, expiresAt };
  }

  /**
   * Verify an enrollment token's validity.
   * Checks expiry, usage count, and employee binding.
   */
  async verifyToken(dto: VerifyTokenDto): Promise<{
    valid: boolean;
    userId?: string;
    employeeId?: string;
    remainingDevices?: number;
    expiresAt?: Date;
    reason?: string;
  }> {
    const tokenRecord = await this.enrollmentTokenModel.findOne({ token: dto.token });

    if (!tokenRecord) {
      return { valid: false, reason: 'Token not found' };
    }

    if (new Date() > tokenRecord.expiresAt) {
      return { valid: false, reason: 'Token has expired' };
    }

    if (tokenRecord.isUsed && tokenRecord.usedCount >= tokenRecord.maxDevices) {
      return { valid: false, reason: 'Token has been fully consumed' };
    }

    if (tokenRecord.employeeId !== dto.employeeId) {
      return { valid: false, reason: 'Employee ID does not match this token' };
    }

    // Verify user still exists and is active
    const user = await this.usersService.findById(tokenRecord.userId.toString());
    if (!user || !user.isActive) {
      return { valid: false, reason: 'Associated user account is inactive' };
    }

    return {
      valid: true,
      userId: tokenRecord.userId.toString(),
      employeeId: tokenRecord.employeeId,
      remainingDevices: tokenRecord.maxDevices - tokenRecord.usedCount,
      expiresAt: tokenRecord.expiresAt,
    };
  }

  /**
   * Full device enrollment flow.
   * Validates token → registers device → signs CSR → returns certificate.
   */
  async enrollDevice(dto: EnrollDeviceDto, ip: string): Promise<{
    certificate: string;
    serialNumber: string;
    issuingCa: string;
    caChain: string[];
    deviceId: string;
    validFrom: Date;
    validTo: Date;
  }> {
    // 1. Validate enrollment token
    const tokenResult = await this.verifyToken({
      token: dto.enrollmentToken,
      employeeId: dto.employeeId,
    });

    if (!tokenResult.valid) {
      await this.auditService.log({
        action: AuditAction.ENROLLMENT_FAILURE,
        resource: 'enrollment',
        ipAddress: ip,
        metadata: {
          employeeId: dto.employeeId,
          deviceFingerprint: dto.deviceFingerprint,
          reason: tokenResult.reason,
        },
        status: 'failure',
      });
      throw new UnauthorizedException(`Enrollment failed: ${tokenResult.reason}`);
    }

    // 2. Validate CSR format
    if (!CertificateUtil.isValidCsrPem(dto.csr)) {
      throw new BadRequestException('Invalid CSR format. PEM-encoded PKCS#10 required.');
    }

    // 3. Check for duplicate device fingerprint
    const existingDevice = await this.devicesService.findByFingerprint(dto.deviceFingerprint);
    if (existingDevice) {
      if (existingDevice.status === DeviceStatus.BLOCKED) {
        throw new BadRequestException('This device has been blocked. Contact your administrator.');
      }
      if (existingDevice.status === DeviceStatus.APPROVED) {
        throw new ConflictException('This device is already enrolled and approved.');
      }
    }

    // 4. Register device
    const device = await this.devicesService.registerDevice(
      {
        fingerprint: dto.deviceFingerprint,
        employeeId: dto.employeeId,
        hostname: dto.hostname,
        platform: dto.platform,
        arch: dto.arch,
        osVersion: dto.osVersion,
        macAddress: dto.macAddress,
        serialNumber: dto.serialNumber,
      },
      tokenResult.userId!,
    );

    // 5. Auto-approve device (enrollment token = admin trust)
    await this.devicesService.approveDevice(device.deviceId, 'system:enrollment');

    // 6. Sign CSR and generate certificate
    const certResult = await this.certificatesService.signAndStoreCertificate({
      csr: dto.csr,
      userId: tokenResult.userId!,
      employeeId: dto.employeeId,
      deviceId: device.deviceId,
      deviceFingerprint: dto.deviceFingerprint,
    });

    // 7. Consume enrollment token
    const tokenRecord = await this.enrollmentTokenModel.findOne({ token: dto.enrollmentToken });
    if (tokenRecord) {
      tokenRecord.usedCount += 1;
      tokenRecord.usedAt = new Date();
      tokenRecord.usedByDeviceFingerprint = dto.deviceFingerprint;
      tokenRecord.usedFromIp = ip;
      if (tokenRecord.usedCount >= tokenRecord.maxDevices) {
        tokenRecord.isUsed = true;
      }
      await tokenRecord.save();
    }

    // 8. Audit log
    await this.auditService.log({
      action: AuditAction.DEVICE_ENROLLMENT,
      resource: 'device',
      resourceId: device.deviceId,
      userId: tokenResult.userId,
      ipAddress: ip,
      metadata: {
        employeeId: dto.employeeId,
        deviceFingerprint: dto.deviceFingerprint,
        certificateSerial: certResult.serialNumber,
        hostname: dto.hostname,
        platform: dto.platform,
      },
      status: 'success',
    });

    this.logger.log(
      `✅ Device enrolled: deviceId=${device.deviceId}, employee=${dto.employeeId}, cert=${certResult.serialNumber}`,
    );

    return {
      certificate: certResult.certificate,
      serialNumber: certResult.serialNumber,
      issuingCa: certResult.issuingCa,
      caChain: certResult.caChain,
      deviceId: device.deviceId,
      validFrom: certResult.validFrom,
      validTo: certResult.validTo,
    };
  }

  /**
   * Renew an existing certificate.
   * Validates current certificate, then issues a new one.
   */
  async renewCertificate(dto: RenewCertificateDto, ip: string): Promise<{
    certificate: string;
    serialNumber: string;
    issuingCa: string;
    caChain: string[];
    validFrom: Date;
    validTo: Date;
  }> {
    // 1. Verify current certificate
    const verification = await this.certificatesService.verifyCertificate(
      dto.currentCertificate,
      dto.deviceFingerprint,
    );

    if (!verification.valid) {
      throw new UnauthorizedException(`Certificate renewal failed: ${verification.reason}`);
    }

    // 2. Validate new CSR
    if (!CertificateUtil.isValidCsrPem(dto.newCsr)) {
      throw new BadRequestException('Invalid new CSR format');
    }

    // 3. Revoke old certificate
    await this.certificatesService.revokeCertificate(
      verification.serialNumber,
      'system:renewal',
      'superseded',
      ip,
    );

    // 4. Issue new certificate
    const certResult = await this.certificatesService.signAndStoreCertificate({
      csr: dto.newCsr,
      userId: verification.userId,
      employeeId: verification.employeeId,
      deviceId: verification.deviceId,
      deviceFingerprint: dto.deviceFingerprint,
    });

    // 5. Audit log
    await this.auditService.log({
      action: AuditAction.CERTIFICATE_RENEWAL,
      resource: 'certificate',
      resourceId: certResult.serialNumber,
      userId: verification.userId,
      ipAddress: ip,
      metadata: {
        previousSerial: verification.serialNumber,
        newSerial: certResult.serialNumber,
      },
      status: 'success',
    });

    this.logger.log(
      `Certificate renewed: ${verification.serialNumber} → ${certResult.serialNumber}`,
    );

    return {
      certificate: certResult.certificate,
      serialNumber: certResult.serialNumber,
      issuingCa: certResult.issuingCa,
      caChain: certResult.caChain,
      validFrom: certResult.validFrom,
      validTo: certResult.validTo,
    };
  }
}
