import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CertificatesService } from '../certificates.service';
import {
  CertificateEntity,
  CertificateStatus,
} from '../schemas/certificate.schema';
import { CertificateRevocationEntity } from '../schemas/certificate-revocation.schema';
import { CertificateSchema } from '../schemas/certificate.schema';
import { VaultPkiService } from '../../vault/vault-pki.service';
import { DevicesService } from '../../devices/devices.service';
import { SessionsService } from '../../sessions/sessions.service';
import { CertificateUtil } from '../../../shared/utils/certificate.util';
import mongoose from 'mongoose';

const certPem = '-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----';

/** Same serial, formatted the way the issuer emitted it vs. how it is stored. */
const presentedSerial = '11:22:AB:CD';
const normalizedSerial = '1122abcd';

const storedCert = {
  _id: new Types.ObjectId(),
  serialNumber: '1122abcd',
  serialNumberNormalized: normalizedSerial,
  userId: new Types.ObjectId(),
  employeeId: 'EMP-001',
  deviceId: 'dev_abc123',
  deviceFingerprint: 'f'.repeat(64),
  fingerprint: 'computed-fingerprint',
  status: CertificateStatus.ACTIVE,
  validFrom: new Date(Date.now() - 86400000),
  validTo: new Date(Date.now() + 86400000),
};

describe('CertificatesService.verifyCertificate — serial lookup', () => {
  let service: CertificatesService;
  let certificateModel: { findOne: jest.Mock; find: jest.Mock };
  let revocationModel: { findOne: jest.Mock; create: jest.Mock };
  let sessionsService: { endDeviceSessions: jest.Mock };

  beforeEach(async () => {
    certificateModel = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
    revocationModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    };
    sessionsService = {
      endDeviceSessions: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificatesService,
        {
          provide: getModelToken(CertificateEntity.name),
          useValue: certificateModel,
        },
        {
          provide: getModelToken(CertificateRevocationEntity.name),
          useValue: revocationModel,
        },
        {
          provide: VaultPkiService,
          useValue: {
            getIntermediateCaCertificate: jest
              .fn()
              .mockRejectedValue(new Error('vault offline')),
            revokeCertificate: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DevicesService,
          useValue: { isDeviceTrusted: jest.fn().mockResolvedValue(true) },
        },
        { provide: SessionsService, useValue: sessionsService },
      ],
    }).compile();

    service = module.get<CertificatesService>(CertificatesService);

    jest.spyOn(CertificateUtil, 'isValidCertificatePem').mockReturnValue(true);
    jest.spyOn(CertificateUtil, 'parseCertificate').mockReturnValue({
      subject: 'CN=EMP-001.dev_abc123.securevault.local',
      issuer: 'CN=SecureVault Intermediate CA',
      serialNumber: presentedSerial,
      validFrom: storedCert.validFrom,
      validTo: storedCert.validTo,
      fingerprint: 'sha1',
      fingerprint256: 'sha256',
      isCA: false,
    });
    jest
      .spyOn(CertificateUtil, 'computeFingerprint')
      .mockReturnValue('computed-fingerprint');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should find a differently formatted serial with one indexed query, not a collection scan', async () => {
    certificateModel.findOne
      .mockResolvedValueOnce(null) // exact-serial fast path misses
      .mockResolvedValueOnce(storedCert); // normalized lookup hits

    const result = await service.verifyCertificate(
      certPem,
      storedCert.deviceFingerprint,
    );

    expect(result.valid).toBe(true);
    expect(result.employeeId).toBe('EMP-001');

    // Fast path unchanged: exact serial as presented.
    expect(certificateModel.findOne).toHaveBeenNthCalledWith(1, {
      serialNumber: presentedSerial,
    });

    // Fallback is now a single indexed query on the normalized column.
    expect(certificateModel.findOne).toHaveBeenNthCalledWith(2, {
      serialNumberNormalized: normalizedSerial,
    });

    // The unbounded "load every non-revoked certificate" scan is gone.
    expect(certificateModel.find).not.toHaveBeenCalled();
  });

  it('should skip the normalized lookup when the exact serial matches', async () => {
    certificateModel.findOne.mockResolvedValueOnce({
      ...storedCert,
      serialNumber: presentedSerial,
    });

    const result = await service.verifyCertificate(
      certPem,
      storedCert.deviceFingerprint,
    );

    expect(result.valid).toBe(true);
    // Exactly one certificate query — no follow-up normalized lookup.
    expect(certificateModel.findOne).toHaveBeenCalledTimes(1);
    expect(certificateModel.findOne).toHaveBeenNthCalledWith(1, {
      serialNumber: presentedSerial,
    });
    expect(certificateModel.find).not.toHaveBeenCalled();
  });

  it('should end the device sessions when a certificate is revoked', async () => {
    const cert = {
      ...storedCert,
      status: CertificateStatus.ACTIVE,
      save: jest.fn().mockResolvedValue(undefined),
    };
    certificateModel.findOne.mockResolvedValue(cert);

    await service.revokeCertificate(
      storedCert.serialNumber,
      'admin-user-id',
      'key_compromise',
    );

    expect(cert.status).toBe(CertificateStatus.REVOKED);
    expect(sessionsService.endDeviceSessions).toHaveBeenCalledWith(
      storedCert.deviceId,
    );
  });

  it('should report not-found without scanning when neither lookup matches', async () => {
    certificateModel.findOne.mockResolvedValue(null);

    const result = await service.verifyCertificate(certPem);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Certificate not found in trust store');
    expect(certificateModel.find).not.toHaveBeenCalled();
  });
});

describe('CertificateSchema — serialNumberNormalized', () => {
  // Model registration only; validate() runs middleware without touching a DB.
  const CertModel = mongoose.model('CertificateSchemaTest', CertificateSchema);

  const buildDoc = (serialNumber: string) =>
    new CertModel({
      serialNumber,
      userId: new Types.ObjectId(),
      employeeId: 'EMP-001',
      deviceId: 'dev_abc123',
      deviceFingerprint: 'f'.repeat(64),
      fingerprint: 'cert-fingerprint',
      issuer: 'CN=SecureVault Intermediate CA',
      subject: 'CN=EMP-001.dev_abc123.securevault.local',
      validFrom: new Date(),
      validTo: new Date(Date.now() + 86400000),
    });

  it('should derive the normalized serial on write', async () => {
    const doc = buildDoc('11:22:AB:CD');
    await doc.validate();

    expect(doc.get('serialNumberNormalized')).toBe('1122abcd');
  });

  it('should leave an already normalized serial unchanged', async () => {
    const doc = buildDoc('1122abcd');
    await doc.validate();

    expect(doc.get('serialNumberNormalized')).toBe('1122abcd');
  });

  it('should match CertificateUtil.normalizeSerialNumber', async () => {
    const serial = 'AA:bb:01:FF';
    const doc = buildDoc(serial);
    await doc.validate();

    expect(doc.get('serialNumberNormalized')).toBe(
      CertificateUtil.normalizeSerialNumber(serial),
    );
  });

  it('should index the normalized serial', () => {
    const indexed = CertificateSchema.indexes().some(
      ([fields]) => 'serialNumberNormalized' in fields,
    );

    expect(indexed).toBe(true);
  });
});
