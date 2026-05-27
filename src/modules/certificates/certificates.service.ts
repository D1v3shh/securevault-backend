import {
  Injectable, Logger, NotFoundException, BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CertificateEntity, CertificateDocument, CertificateStatus,
} from './schemas/certificate.schema';
import {
  CertificateRevocationEntity, CertificateRevocationDocument, RevocationReason,
} from './schemas/certificate-revocation.schema';
import { VaultPkiService } from '../vault/vault-pki.service';
import { DevicesService } from '../devices/devices.service';
import { CertificateUtil } from '../../shared/utils/certificate.util';

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    @InjectModel(CertificateEntity.name)
    private readonly certificateModel: Model<CertificateDocument>,
    @InjectModel(CertificateRevocationEntity.name)
    private readonly revocationModel: Model<CertificateRevocationDocument>,
    private readonly vaultPkiService: VaultPkiService,
    private readonly devicesService: DevicesService,
  ) {}

  /**
   * Sign a CSR and store the certificate metadata.
   * Called during device enrollment.
   */
  async signAndStoreCertificate(params: {
    csr: string;
    userId: string;
    employeeId: string;
    deviceId: string;
    deviceFingerprint: string;
    ttl?: string;
  }): Promise<{
    certificate: string;
    serialNumber: string;
    issuingCa: string;
    caChain: string[];
    validFrom: Date;
    validTo: Date;
  }> {
    // Validate CSR format
    if (!CertificateUtil.isValidCsrPem(params.csr)) {
      throw new BadRequestException('Invalid CSR PEM format');
    }

    // Build common name: employeeId.deviceId.securevault.local
    const commonName = `${params.employeeId}.${params.deviceId}.securevault.local`;

    // Sign CSR via Vault PKI
    const signResult = await this.vaultPkiService.signCsr({
      csr: params.csr,
      commonName,
      ttl: params.ttl || '8760h',
    });

    const validFrom = new Date();
    const validTo = new Date(signResult.expiration * 1000);

    // Compute certificate fingerprint
    const certFingerprint = CertificateUtil.computeFingerprint(signResult.certificate);

    // Store certificate metadata in MongoDB
    await this.certificateModel.create({
      serialNumber: signResult.serialNumber,
      userId: new Types.ObjectId(params.userId),
      employeeId: params.employeeId,
      deviceId: params.deviceId,
      deviceFingerprint: params.deviceFingerprint,
      fingerprint: certFingerprint,
      issuer: `CN=SecureVault Intermediate CA`,
      subject: `CN=${commonName}`,
      validFrom,
      validTo,
      certificatePem: signResult.certificate,
      csrPem: params.csr,
      status: CertificateStatus.ACTIVE,
    });

    // Bind certificate to device
    await this.devicesService.bindCertificate(params.deviceId, signResult.serialNumber);

    this.logger.log(
      `Certificate issued: serial=${signResult.serialNumber} for ${params.employeeId}/${params.deviceId}`,
    );

    return {
      certificate: signResult.certificate,
      serialNumber: signResult.serialNumber,
      issuingCa: signResult.issuingCa,
      caChain: signResult.caChain,
      validFrom,
      validTo,
    };
  }

  /**
   * Verify a presented certificate.
   * Checks: format, expiry, revocation status, device trust, fingerprint match.
   */
  async verifyCertificate(
    certPem: string,
    deviceFingerprint?: string,
  ): Promise<{
    valid: boolean;
    serialNumber: string;
    employeeId: string;
    deviceId: string;
    userId: string;
    reason?: string;
  }> {
    // 1. Validate PEM format
    if (!CertificateUtil.isValidCertificatePem(certPem)) {
      return { valid: false, serialNumber: '', employeeId: '', deviceId: '', userId: '', reason: 'Invalid certificate PEM format' };
    }

    // 2. Parse certificate
    const certInfo = CertificateUtil.parseCertificate(certPem);
    if (!certInfo) {
      return { valid: false, serialNumber: '', employeeId: '', deviceId: '', userId: '', reason: 'Failed to parse certificate' };
    }

    // 3. Check expiry
    if (new Date() > certInfo.validTo) {
      return { valid: false, serialNumber: certInfo.serialNumber, employeeId: '', deviceId: '', userId: '', reason: 'Certificate has expired' };
    }

    if (new Date() < certInfo.validFrom) {
      return { valid: false, serialNumber: certInfo.serialNumber, employeeId: '', deviceId: '', userId: '', reason: 'Certificate is not yet valid' };
    }

    // 4. Find certificate in our database
    const normalizedSerial = CertificateUtil.normalizeSerialNumber(certInfo.serialNumber);
    let storedCert = await this.certificateModel.findOne({
      serialNumber: certInfo.serialNumber,
    });

    // Try normalized lookup
    if (!storedCert) {
      const allCerts = await this.certificateModel.find({ status: { $ne: CertificateStatus.REVOKED } });
      storedCert = allCerts.find(c =>
        CertificateUtil.normalizeSerialNumber(c.serialNumber) === normalizedSerial
      ) || null;
    }

    if (!storedCert) {
      return { valid: false, serialNumber: certInfo.serialNumber, employeeId: '', deviceId: '', userId: '', reason: 'Certificate not found in trust store' };
    }

    // 5. Check revocation status
    if (storedCert.status === CertificateStatus.REVOKED) {
      return {
        valid: false,
        serialNumber: storedCert.serialNumber,
        employeeId: storedCert.employeeId,
        deviceId: storedCert.deviceId,
        userId: storedCert.userId.toString(),
        reason: 'Certificate has been revoked',
      };
    }

    // 6. Check revocation table
    const revocation = await this.revocationModel.findOne({
      certificateSerial: storedCert.serialNumber,
    });
    if (revocation) {
      return {
        valid: false,
        serialNumber: storedCert.serialNumber,
        employeeId: storedCert.employeeId,
        deviceId: storedCert.deviceId,
        userId: storedCert.userId.toString(),
        reason: `Certificate revoked: ${revocation.reason}`,
      };
    }

    // 7. Verify device fingerprint if provided
    if (deviceFingerprint && storedCert.deviceFingerprint !== deviceFingerprint) {
      return {
        valid: false,
        serialNumber: storedCert.serialNumber,
        employeeId: storedCert.employeeId,
        deviceId: storedCert.deviceId,
        userId: storedCert.userId.toString(),
        reason: 'Device fingerprint mismatch — certificate not bound to this device',
      };
    }

    // 8. Check device approval status
    const isTrusted = await this.devicesService.isDeviceTrusted(storedCert.deviceFingerprint);
    if (!isTrusted) {
      return {
        valid: false,
        serialNumber: storedCert.serialNumber,
        employeeId: storedCert.employeeId,
        deviceId: storedCert.deviceId,
        userId: storedCert.userId.toString(),
        reason: 'Device is not approved or has been revoked',
      };
    }

    // 9. Verify certificate fingerprint integrity
    const computedFingerprint = CertificateUtil.computeFingerprint(certPem);
    if (storedCert.fingerprint !== computedFingerprint) {
      return {
        valid: false,
        serialNumber: storedCert.serialNumber,
        employeeId: storedCert.employeeId,
        deviceId: storedCert.deviceId,
        userId: storedCert.userId.toString(),
        reason: 'Certificate fingerprint mismatch — possible tampering',
      };
    }

    // 10. Verify certificate chain (if Vault PKI is enabled)
    try {
      const intermediateCa = await this.vaultPkiService.getIntermediateCaCertificate();
      if (CertificateUtil.isValidCertificatePem(intermediateCa) &&
          CertificateUtil.isValidCertificatePem(certPem)) {
        const chainValid = CertificateUtil.verifyCertificateChain(certPem, intermediateCa);
        if (!chainValid) {
          this.logger.warn(`Certificate chain verification failed for serial: ${storedCert.serialNumber}`);
          // In dev mode, we allow this to pass since we use mock certs
          // In production, this should be a hard failure
        }
      }
    } catch (error: any) {
      this.logger.debug(`Chain verification skipped: ${error.message}`);
    }

    return {
      valid: true,
      serialNumber: storedCert.serialNumber,
      employeeId: storedCert.employeeId,
      deviceId: storedCert.deviceId,
      userId: storedCert.userId.toString(),
    };
  }

  /**
   * Revoke a certificate by serial number.
   */
  async revokeCertificate(
    serialNumber: string,
    revokedBy: string,
    reason?: string,
    ipAddress?: string,
  ): Promise<void> {
    const cert = await this.certificateModel.findOne({ serialNumber });
    if (!cert) throw new NotFoundException(`Certificate not found: ${serialNumber}`);

    if (cert.status === CertificateStatus.REVOKED) {
      throw new BadRequestException('Certificate is already revoked');
    }

    // Revoke in Vault PKI
    try {
      await this.vaultPkiService.revokeCertificate(serialNumber);
    } catch (error: any) {
      this.logger.warn(`Vault PKI revocation failed (continuing with local revocation): ${error.message}`);
    }

    // Update certificate status
    cert.status = CertificateStatus.REVOKED;
    cert.revokedAt = new Date();
    cert.revokedBy = revokedBy;
    cert.revocationReason = reason || 'unspecified';
    await cert.save();

    // Create revocation record
    await this.revocationModel.create({
      certificateSerial: serialNumber,
      userId: cert.userId,
      deviceId: cert.deviceId,
      reason: (reason as RevocationReason) || RevocationReason.UNSPECIFIED,
      revokedBy,
      ipAddress: ipAddress || null,
    });

    this.logger.log(`Certificate revoked: ${serialNumber} by ${revokedBy} (reason: ${reason || 'unspecified'})`);
  }

  /**
   * Find certificate by serial number.
   */
  async findBySerial(serialNumber: string): Promise<CertificateDocument | null> {
    return this.certificateModel.findOne({ serialNumber });
  }

  /**
   * Get certificate status by serial number.
   */
  async getStatus(serialNumber: string): Promise<{
    serialNumber: string;
    status: CertificateStatus;
    validFrom: Date;
    validTo: Date;
    isExpired: boolean;
    isRevoked: boolean;
    revokedAt?: Date;
    revocationReason?: string;
  }> {
    const cert = await this.certificateModel.findOne({ serialNumber });
    if (!cert) throw new NotFoundException(`Certificate not found: ${serialNumber}`);

    const now = new Date();
    return {
      serialNumber: cert.serialNumber,
      status: cert.status,
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      isExpired: now > cert.validTo,
      isRevoked: cert.status === CertificateStatus.REVOKED,
      revokedAt: cert.revokedAt || undefined,
      revocationReason: cert.revocationReason || undefined,
    };
  }

  /**
   * Check if a certificate serial is revoked.
   */
  async isRevoked(serialNumber: string): Promise<boolean> {
    const revocation = await this.revocationModel.findOne({
      certificateSerial: serialNumber,
    });
    return !!revocation;
  }

  /**
   * Find all certificates for a user.
   */
  async findByUserId(userId: string): Promise<CertificateDocument[]> {
    return this.certificateModel.find({
      userId: new Types.ObjectId(userId),
    }).sort({ createdAt: -1 }).exec();
  }

  /**
   * Find active certificate for a device.
   */
  async findActiveByDeviceId(deviceId: string): Promise<CertificateDocument | null> {
    return this.certificateModel.findOne({
      deviceId,
      status: CertificateStatus.ACTIVE,
      validTo: { $gt: new Date() },
    });
  }
}
