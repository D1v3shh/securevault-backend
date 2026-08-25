import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import * as crypto from 'crypto';
import { FilesService } from '../files.service';
import { FileEntity } from '../schemas/file.schema';
import { EncryptionService } from '../../encryption/encryption.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { FileAccessValidationService } from '../../shares/services/file-access-validation.service';
import { AccessDeniedException } from '../../shares/exceptions/access-denied.exception';
import { ShareAction } from '../../shares/enums/share-permission.enum';
import { SharePermission } from '../../shares/enums/share-permission.enum';
import { ShareStatus } from '../../shares/enums/share-status.enum';
import { Role } from '../../permissions/constants/roles.enum';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';

// ─── Test Fixtures ─────────────────────────────────────
const fileMongoId = new Types.ObjectId();
const ownerId = new Types.ObjectId();
const recipientId = new Types.ObjectId();
const adminId = new Types.ObjectId();
const shareId = new Types.ObjectId();

/** Plaintext the mocked EncryptionService "decrypts" to. */
const plaintext = Buffer.from('confidential-payload');
const plaintextChecksum = crypto
  .createHash('sha256')
  .update(plaintext)
  .digest('hex');

const createMockFile = (overrides: Partial<any> = {}) => ({
  _id: fileMongoId,
  uuid: 'file-uuid-1234',
  originalName: 'quarterly-report.pdf',
  storagePath: '2026/08/25/file-uuid-1234.pdf',
  mimeType: 'application/pdf',
  size: plaintext.length,
  checksum: plaintextChecksum,
  encryptionKeyId: 'key-1',
  encryptedDek: Buffer.from('encrypted-dek').toString('hex'),
  encryptionIv: Buffer.alloc(16, 1).toString('hex'),
  encryptionAuthTag: Buffer.alloc(16, 2).toString('hex'),
  uploadedBy: ownerId,
  accessLevel: 'private',
  department: null,
  description: null,
  isDeleted: false,
  ...overrides,
});

const createMockShare = (overrides: Partial<any> = {}) => ({
  _id: shareId,
  fileId: fileMongoId,
  ownerId,
  sharedWithUserId: recipientId,
  permission: SharePermission.DOWNLOAD,
  status: ShareStatus.ACTIVE,
  sharedAt: new Date(),
  expiresAt: new Date(Date.now() + 86400000),
  maxDownloads: null,
  downloadCount: 0,
  oneTimeAccess: false,
  ...overrides,
});

const ownerUser: AuthenticatedUser = {
  userId: ownerId.toString(),
  uuid: 'owner-uuid',
  email: 'owner@test.com',
  role: Role.EMPLOYEE,
};

const adminUser: AuthenticatedUser = {
  userId: adminId.toString(),
  uuid: 'admin-uuid',
  email: 'admin@test.com',
  role: Role.ADMIN,
};

const recipientUser: AuthenticatedUser = {
  userId: recipientId.toString(),
  uuid: 'recipient-uuid',
  email: 'recipient@test.com',
  role: Role.EMPLOYEE,
};

const strangerUser: AuthenticatedUser = {
  userId: new Types.ObjectId().toString(),
  uuid: 'stranger-uuid',
  email: 'stranger@test.com',
  role: Role.EMPLOYEE,
};

describe('FilesService — download access control', () => {
  let service: FilesService;
  let fileModel: { findOne: jest.Mock; countDocuments: jest.Mock };
  let encryptionService: { decryptKey: jest.Mock; decrypt: jest.Mock };
  let storageService: { download: jest.Mock };
  let auditService: { log: jest.Mock };
  let validationService: {
    validateAccess: jest.Mock;
    recordDownload: jest.Mock;
  };

  beforeEach(async () => {
    fileModel = {
      findOne: jest.fn().mockResolvedValue(createMockFile()),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    encryptionService = {
      decryptKey: jest.fn().mockResolvedValue(Buffer.alloc(32, 7)),
      decrypt: jest.fn().mockResolvedValue(plaintext),
    };
    storageService = {
      download: jest.fn().mockResolvedValue(Buffer.from('encrypted-bytes')),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    validationService = {
      validateAccess: jest.fn(),
      recordDownload: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: getModelToken(FileEntity.name), useValue: fileModel },
        { provide: EncryptionService, useValue: encryptionService },
        { provide: StorageService, useValue: storageService },
        { provide: AuditService, useValue: auditService },
        {
          provide: FileAccessValidationService,
          useValue: validationService,
        },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Owner ───────────────────────────────────────────

  it('should let the owner download their own file without any share lookup', async () => {
    const { buffer, file, share } = await service.downloadFile(
      'file-uuid-1234',
      ownerUser,
      '127.0.0.1',
    );

    expect(buffer).toEqual(plaintext);
    expect(file.uuid).toBe('file-uuid-1234');
    expect(share).toBeUndefined();

    // Ownership is checked before the share gate is ever consulted.
    expect(validationService.validateAccess).not.toHaveBeenCalled();
  });

  // ─── Admin ───────────────────────────────────────────

  it('should let an ADMIN download any file without any share lookup', async () => {
    const { buffer, share } = await service.downloadFile(
      'file-uuid-1234',
      adminUser,
      '127.0.0.1',
    );

    expect(buffer).toEqual(plaintext);
    expect(share).toBeUndefined();
    expect(validationService.validateAccess).not.toHaveBeenCalled();
  });

  it('should let a SUPER_ADMIN download any file', async () => {
    const { buffer } = await service.downloadFile(
      'file-uuid-1234',
      { ...adminUser, role: Role.SUPER_ADMIN },
      '127.0.0.1',
    );

    expect(buffer).toEqual(plaintext);
    expect(validationService.validateAccess).not.toHaveBeenCalled();
  });

  // ─── Shared access ───────────────────────────────────

  it('should let a user with an ACTIVE share download the file', async () => {
    const grantedShare = createMockShare();
    validationService.validateAccess.mockResolvedValue(grantedShare);

    const { buffer, share } = await service.downloadFile(
      'file-uuid-1234',
      recipientUser,
      '127.0.0.1',
    );

    expect(buffer).toEqual(plaintext);
    expect(share).toBe(grantedShare);

    // Checked as a DOWNLOAD action against the file's Mongo _id.
    expect(validationService.validateAccess).toHaveBeenCalledWith(
      fileMongoId.toString(),
      recipientUser.userId,
      ShareAction.DOWNLOAD,
      undefined,
    );
  });

  it('should not consume download quota until the transfer has completed', async () => {
    const grantedShare = createMockShare({ maxDownloads: 1 });
    validationService.validateAccess.mockResolvedValue(grantedShare);

    const { share } = await service.downloadFile(
      'file-uuid-1234',
      recipientUser,
      '127.0.0.1',
    );

    // downloadFile only prepares the bytes — nothing has reached the client yet.
    expect(validationService.recordDownload).not.toHaveBeenCalled();

    // The caller records it once the response has been flushed.
    await service.recordShareDownload(share!._id.toString());
    expect(validationService.recordDownload).toHaveBeenCalledWith(
      shareId.toString(),
    );
  });

  it('should swallow errors raised while recording a completed download', async () => {
    validationService.recordDownload.mockRejectedValue(new Error('db down'));

    await expect(
      service.recordShareDownload(shareId.toString()),
    ).resolves.toBeUndefined();
  });

  // ─── No grant ────────────────────────────────────────

  it('should reject a user with no share grant with 403', async () => {
    validationService.validateAccess.mockRejectedValue(
      new AccessDeniedException(),
    );

    const download = service.downloadFile(
      'file-uuid-1234',
      strangerUser,
      '127.0.0.1',
    );

    await expect(download).rejects.toThrow(ForbiddenException);
    await expect(download).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });

    // Nothing was read or decrypted for an unauthorized requester.
    expect(storageService.download).not.toHaveBeenCalled();
    expect(encryptionService.decrypt).not.toHaveBeenCalled();
    expect(validationService.recordDownload).not.toHaveBeenCalled();
  });

  // ─── accessLevel rules stay intact ───────────────────

  it('should still allow any authenticated user to download an internal file', async () => {
    fileModel.findOne.mockResolvedValue(
      createMockFile({ accessLevel: 'internal' }),
    );

    const { buffer } = await service.downloadFile(
      'file-uuid-1234',
      strangerUser,
      '127.0.0.1',
    );

    expect(buffer).toEqual(plaintext);
    expect(validationService.validateAccess).not.toHaveBeenCalled();
  });

  // ─── Integrity check must remain in place ────────────

  it('should reject the download when the decrypted checksum does not match', async () => {
    encryptionService.decrypt.mockResolvedValue(Buffer.from('tampered-bytes'));

    await expect(
      service.downloadFile('file-uuid-1234', ownerUser, '127.0.0.1'),
    ).rejects.toThrow('File integrity check failed');
  });
});
