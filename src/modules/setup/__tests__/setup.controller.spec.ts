import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import request from 'supertest';
import { SetupController } from '../setup.controller';
import { SetupService } from '../setup.service';
import { CertificatesService } from '../../certificates/certificates.service';
import { CertificateEntity } from '../../certificates/schemas/certificate.schema';
import { CertificateRevocationEntity } from '../../certificates/schemas/certificate-revocation.schema';
import { VaultPkiService } from '../../vault/vault-pki.service';
import { DevicesService } from '../../devices/devices.service';
import { SessionsService } from '../../sessions/sessions.service';
import { GlobalExceptionFilter } from '../../../common/filters/http-exception.filter';
import { APP_CONSTANTS } from '../../../shared/constants/app.constants';

const validCsr = [
  '-----BEGIN CERTIFICATE REQUEST-----',
  'MIICijCCAXICAQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGU=',
  '-----END CERTIFICATE REQUEST-----',
].join('\n');

const requestBody = {
  csr: validCsr,
  employeeId: 'EMP-001',
  deviceId: 'dev_abc123',
  deviceFingerprint: 'a'.repeat(64),
};

describe('SetupController — POST /setup/generate-certificate', () => {
  let app: INestApplication;
  let certificateModel: { create: jest.Mock; findOne: jest.Mock };
  let devicesService: { bindCertificate: jest.Mock };

  beforeEach(async () => {
    certificateModel = {
      create: jest.fn().mockImplementation((doc: unknown) => doc),
      findOne: jest.fn().mockResolvedValue(null),
    };
    devicesService = {
      bindCertificate: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SetupController],
      providers: [
        CertificatesService,
        { provide: SetupService, useValue: {} },
        {
          provide: getModelToken(CertificateEntity.name),
          useValue: certificateModel,
        },
        {
          provide: getModelToken(CertificateRevocationEntity.name),
          useValue: { create: jest.fn(), findOne: jest.fn() },
        },
        {
          provide: VaultPkiService,
          useValue: {
            signCsr: jest.fn().mockResolvedValue({
              certificate:
                '-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----',
              serialNumber: '11:22:33:44',
              issuingCa:
                '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
              caChain: [],
              expiration: Math.floor(Date.now() / 1000) + 86400,
            }),
          },
        },
        { provide: DevicesService, useValue: devicesService },
        {
          provide: SessionsService,
          useValue: {
            endDeviceSessions: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    // Mirror main.ts so status codes match production behaviour.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('should not return 500 — the system owner id must cast to an ObjectId', async () => {
    const response = await request(app.getHttpServer())
      .post('/setup/generate-certificate')
      .send(requestBody);

    // Regression: passing 'system' straight into new Types.ObjectId() threw a
    // BSONError here, which the global filter turned into a 500.
    expect(response.status).not.toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body).toMatchObject({ serialNumber: '11:22:33:44' });
  });

  it('should attribute the certificate to the reserved system user', async () => {
    await request(app.getHttpServer())
      .post('/setup/generate-certificate')
      .send(requestBody)
      .expect(HttpStatus.CREATED);

    expect(certificateModel.create).toHaveBeenCalledTimes(1);
    const stored = certificateModel.create.mock.calls[0][0] as {
      userId: Types.ObjectId;
      employeeId: string;
      deviceId: string;
    };

    expect(stored.userId).toBeInstanceOf(Types.ObjectId);
    expect(stored.userId.toString()).toBe(APP_CONSTANTS.SYSTEM_USER_ID);
    expect(stored.employeeId).toBe('EMP-001');
    expect(stored.deviceId).toBe('dev_abc123');
  });

  it('should bind the issued certificate to the device', async () => {
    await request(app.getHttpServer())
      .post('/setup/generate-certificate')
      .send(requestBody)
      .expect(HttpStatus.CREATED);

    expect(devicesService.bindCertificate).toHaveBeenCalledWith(
      'dev_abc123',
      '11:22:33:44',
    );
  });

  it('should return 400, not 500, for a malformed CSR', async () => {
    const response = await request(app.getHttpServer())
      .post('/setup/generate-certificate')
      .send({ ...requestBody, csr: 'not-a-csr' });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(certificateModel.create).not.toHaveBeenCalled();
  });
});
