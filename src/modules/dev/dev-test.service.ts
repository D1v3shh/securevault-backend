import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CertificateEntity, CertificateDocument, CertificateStatus } from '../certificates/schemas/certificate.schema';
import { DeviceEntity, DeviceDocument } from '../devices/schemas/device.schema';
import { UserEntity, UserDocument } from '../users/schemas/user.schema';

/**
 * Development-only service for testing certificate-based auth.
 * ⚠️ This service is ONLY loaded in non-production environments.
 */
@Injectable()
export class DevTestService {
  private readonly logger = new Logger(DevTestService.name);

  constructor(
    @InjectModel(CertificateEntity.name)
    private readonly certificateModel: Model<CertificateDocument>,
    @InjectModel(DeviceEntity.name)
    private readonly deviceModel: Model<DeviceDocument>,
    @InjectModel(UserEntity.name)
    private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * List all available test certificates with their PEM data,
   * device fingerprints, and user info — everything needed to
   * call /auth/certificate-login from Swagger UI.
   */
  async getTestCertificates(): Promise<any[]> {
    // 1. Try loading from test-certs-summary.json
    const summaryPath = path.join(process.cwd(), 'test-certificates', 'test-certs-summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        return summary.map((entry: any) => ({
          role: entry.role,
          email: entry.email,
          employeeId: entry.employeeId,
          deviceId: entry.deviceId,
          deviceFingerprint: entry.deviceFingerprint,
          serialNumber: entry.serialNumber,
          certificatePem: entry.certPem,
          instructions: 'Copy certificatePem and deviceFingerprint to POST /auth/certificate-login',
        }));
      } catch (e) {
        this.logger.warn('Failed to read test-certs-summary.json, falling back to DB lookup');
      }
    }

    // 2. Fallback: load from MongoDB
    const activeCerts = await this.certificateModel.find({
      status: CertificateStatus.ACTIVE,
      validTo: { $gt: new Date() },
    }).sort({ createdAt: -1 }).exec();

    const results = [];

    for (const cert of activeCerts) {
      const user = await this.userModel.findById(cert.userId).exec();
      const device = await this.deviceModel.findOne({
        fingerprint: cert.deviceFingerprint,
      }).exec();

      results.push({
        role: user?.role || 'UNKNOWN',
        email: user?.email || 'unknown',
        employeeId: cert.employeeId,
        deviceId: cert.deviceId,
        deviceFingerprint: cert.deviceFingerprint,
        serialNumber: cert.serialNumber,
        subject: cert.subject,
        issuer: cert.issuer,
        validFrom: cert.validFrom,
        validTo: cert.validTo,
        status: cert.status,
        deviceStatus: device?.status || 'unknown',
        certificatePem: cert.certificatePem,
        instructions: 'Copy certificatePem and deviceFingerprint to POST /auth/certificate-login',
      });
    }

    return results;
  }

  /**
   * Get a specific certificate by employee ID — for the quick login shortcut.
   */
  async getCertificateByEmployeeId(employeeId: string): Promise<{
    certificate: string;
    deviceFingerprint: string;
    employeeId: string;
    serialNumber: string;
    userId: string;
  } | null> {
    const cert = await this.certificateModel.findOne({
      employeeId,
      status: CertificateStatus.ACTIVE,
      validTo: { $gt: new Date() },
    });

    if (!cert || !cert.certificatePem) return null;

    return {
      certificate: cert.certificatePem,
      deviceFingerprint: cert.deviceFingerprint,
      employeeId: cert.employeeId,
      serialNumber: cert.serialNumber,
      userId: cert.userId.toString(),
    };
  }

  /**
   * Dev environment status check.
   */
  async getStatus(): Promise<any> {
    const userCount = await this.userModel.countDocuments();
    const deviceCount = await this.deviceModel.countDocuments();
    const certCount = await this.certificateModel.countDocuments();
    const activeCerts = await this.certificateModel.countDocuments({
      status: CertificateStatus.ACTIVE,
      validTo: { $gt: new Date() },
    });

    const summaryPath = path.join(process.cwd(), 'test-certificates', 'test-certs-summary.json');
    const hasCertFiles = fs.existsSync(summaryPath);

    return {
      environment: this.configService.get('app.env', 'development'),
      database: {
        users: userCount,
        devices: deviceCount,
        certificates: certCount,
        activeCertificates: activeCerts,
      },
      testCertificates: {
        generated: hasCertFiles,
        path: hasCertFiles ? 'test-certificates/' : null,
        hint: hasCertFiles
          ? 'Test certificates ready — use GET /dev/test-certificates to list them'
          : 'Run: npx ts-node scripts/generate-test-certs.ts',
      },
    };
  }
}
