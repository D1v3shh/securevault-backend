import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { FilesService } from '../files.service';
import { FileEntity } from '../schemas/file.schema';
import { EncryptionService } from '../../encryption/encryption.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { Role } from '../../permissions/constants/roles.enum';
import * as crypto from 'crypto';

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234'),
}));

describe('FilesService', () => {
  let service: FilesService;
  let fileModel: any;
  let encryptionService: jest.Mocked<Partial<EncryptionService>>;
  let storageService: jest.Mocked<Partial<StorageService>>;
  let auditService: jest.Mocked<Partial<AuditService>>;

  const adminUser = {
    userId: 'admin-id',
    uuid: 'admin-uuid',
    email: 'admin@test.com',
    role: Role.SUPER_ADMIN,
  };

  const normalUser = {
    userId: 'user-id',
    uuid: 'user-uuid',
    email: 'user@test.com',
    role: Role.EMPLOYEE,
  };

  const mockFile = {
    _id: 'file-mongo-id',
    uuid: 'file-uuid-123',
    originalName: 'test.pdf',
    storagePath: '2026/06/01/file-uuid-123.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    checksum: 'abc123checksum',
    encryptionKeyId: 'key-1',
    encryptedDek: 'aabbccdd',
    encryptionIv: '11223344',
    encryptionAuthTag: '55667788',
    uploadedBy: { toString: () => 'user-id' },
    accessLevel: 'private',
    department: null,
    description: 'Test file',
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    save: jest.fn(),
  };

  beforeEach(async () => {
    fileModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };

    encryptionService = {
      generateKey: jest.fn(),
      encrypt: jest.fn(),
      decryptKey: jest.fn(),
      decrypt: jest.fn(),
    };

    storageService = {
      upload: jest.fn(),
      download: jest.fn(),
    };

    auditService = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: getModelToken(FileEntity.name), useValue: fileModel },
        { provide: EncryptionService, useValue: encryptionService },
        { provide: StorageService, useValue: storageService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Upload ──────────────────────────────────────────

  describe('uploadFile', () => {
    const mockMulterFile = {
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('file-content'),
      size: 12,
    } as Express.Multer.File;

    const dto = { accessLevel: 'private' as const };

    it('should upload and encrypt a file successfully', async () => {
      const mockKey = Buffer.from('0'.repeat(64), 'hex');
      encryptionService.generateKey!.mockResolvedValue({
        keyId: 'key-1',
        key: mockKey,
        encryptedKey: Buffer.from('enc-key'),
      });
      encryptionService.encrypt!.mockResolvedValue({
        encryptedData: Buffer.from('encrypted'),
        iv: Buffer.from('1234567890123456'),
        authTag: Buffer.from('1234567890123456'),
      });
      storageService.upload!.mockResolvedValue({ path: 'stored-path', size: 12 });
      fileModel.create.mockResolvedValue(mockFile);

      const result = await service.uploadFile(mockMulterFile, dto, normalUser, '127.0.0.1');

      expect(encryptionService.generateKey).toHaveBeenCalled();
      expect(encryptionService.encrypt).toHaveBeenCalledWith(mockMulterFile.buffer, mockKey);
      expect(storageService.upload).toHaveBeenCalled();
      expect(fileModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: 'mock-uuid-1234',
          originalName: 'test.pdf',
          mimeType: 'application/pdf',
          uploadedBy: 'user-id',
        }),
      );
      expect(auditService.log).toHaveBeenCalled();
      expect(result).toEqual(mockFile);
    });

    it('should reject disallowed MIME types', async () => {
      const badFile = { ...mockMulterFile, mimetype: 'application/x-executable' };

      await expect(service.uploadFile(badFile as any, dto, normalUser, '127.0.0.1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ─── Download ─────────────────────────────────────────

  describe('downloadFile', () => {
    it('should download and decrypt file successfully', async () => {
      const plaintext = Buffer.from('original-content');
      const checksum = crypto.createHash('sha256').update(plaintext).digest('hex');
      const fileWithChecksum = { ...mockFile, checksum };

      fileModel.findOne.mockResolvedValueOnce(fileWithChecksum);
      storageService.download!.mockResolvedValue(Buffer.from('encrypted-data'));
      encryptionService.decryptKey!.mockResolvedValue(Buffer.from('dek'));
      encryptionService.decrypt!.mockResolvedValue(plaintext);

      const result = await service.downloadFile('file-uuid-123', normalUser, '127.0.0.1');

      expect(result.buffer).toEqual(plaintext);
      expect(result.file).toEqual(fileWithChecksum);
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw on checksum mismatch', async () => {
      const fileWithBadChecksum = { ...mockFile, checksum: 'wrong-checksum' };
      fileModel.findOne.mockResolvedValueOnce(fileWithBadChecksum);
      storageService.download!.mockResolvedValue(Buffer.from('encrypted'));
      encryptionService.decryptKey!.mockResolvedValue(Buffer.from('dek'));
      encryptionService.decrypt!.mockResolvedValue(Buffer.from('data'));

      await expect(service.downloadFile('file-uuid-123', normalUser, '127.0.0.1'))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-existent file', async () => {
      fileModel.findOne.mockResolvedValue(null);

      await expect(service.downloadFile('nonexistent', normalUser, '127.0.0.1'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ─── Access Control ──────────────────────────────────

  describe('access control', () => {
    it('should allow owner to access private file', async () => {
      fileModel.findOne.mockResolvedValueOnce(mockFile);

      const result = await service.getFileMetadata('file-uuid-123', normalUser);

      expect(result).toEqual(mockFile);
    });

    it('should allow admin to access private file', async () => {
      const otherUserFile = { ...mockFile, uploadedBy: { toString: () => 'other-user' } };
      fileModel.findOne.mockResolvedValueOnce(otherUserFile);

      const result = await service.getFileMetadata('file-uuid-123', adminUser);

      expect(result).toEqual(otherUserFile);
    });

    it('should deny non-owner access to private file', async () => {
      const otherUserFile = {
        ...mockFile,
        uploadedBy: { toString: () => 'other-user-id' },
        accessLevel: 'private',
      };
      fileModel.findOne.mockResolvedValueOnce(otherUserFile);

      await expect(service.getFileMetadata('file-uuid-123', normalUser))
        .rejects.toThrow(ForbiddenException);
    });

    it('should allow access to internal files for any user', async () => {
      const internalFile = { ...mockFile, accessLevel: 'internal', uploadedBy: { toString: () => 'other' } };
      fileModel.findOne.mockResolvedValueOnce(internalFile);

      const result = await service.getFileMetadata('file-uuid-123', normalUser);

      expect(result).toEqual(internalFile);
    });

    it('should allow managers to access department files', async () => {
      const deptFile = { ...mockFile, accessLevel: 'department', uploadedBy: { toString: () => 'other' } };
      fileModel.findOne.mockResolvedValueOnce(deptFile);
      const managerUser = { ...normalUser, role: Role.MANAGER };

      const result = await service.getFileMetadata('file-uuid-123', managerUser);

      expect(result).toEqual(deptFile);
    });

    it('should deny employees access to department files they do not own', async () => {
      const deptFile = { ...mockFile, accessLevel: 'department', uploadedBy: { toString: () => 'other' } };
      fileModel.findOne.mockResolvedValueOnce(deptFile);

      await expect(service.getFileMetadata('file-uuid-123', normalUser))
        .rejects.toThrow(ForbiddenException);
    });
  });

  // ─── List Files ──────────────────────────────────────

  describe('listFiles', () => {
    it('should return paginated files for admin (sees all)', async () => {
      const populateFn = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([mockFile]) });
      const limitFn = jest.fn().mockReturnValue({ populate: populateFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      const selectFn = jest.fn().mockReturnValue({ sort: sortFn });
      fileModel.find.mockReturnValue({ select: selectFn });
      fileModel.countDocuments.mockResolvedValue(1);

      const result = await service.listFiles({ page: 1, limit: 20 }, adminUser);

      expect(result.data).toEqual([mockFile]);
      expect(result.meta.total).toBe(1);
      // Admin should NOT have $or filter
      const filterArg = fileModel.find.mock.calls[0][0];
      expect(filterArg.$or).toBeUndefined();
    });

    it('should filter files for non-admin users (own + internal/public)', async () => {
      const populateFn = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      const limitFn = jest.fn().mockReturnValue({ populate: populateFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      const selectFn = jest.fn().mockReturnValue({ sort: sortFn });
      fileModel.find.mockReturnValue({ select: selectFn });
      fileModel.countDocuments.mockResolvedValue(0);

      await service.listFiles({ page: 1, limit: 20 }, normalUser);

      const filterArg = fileModel.find.mock.calls[0][0];
      expect(filterArg.$or).toBeDefined();
      expect(filterArg.$or[0]).toEqual({ uploadedBy: 'user-id' });
    });

    it('should apply search and filter params', async () => {
      const populateFn = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      const limitFn = jest.fn().mockReturnValue({ populate: populateFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      const selectFn = jest.fn().mockReturnValue({ sort: sortFn });
      fileModel.find.mockReturnValue({ select: selectFn });
      fileModel.countDocuments.mockResolvedValue(0);

      await service.listFiles(
        { search: 'report', mimeType: 'application/pdf', accessLevel: 'internal' },
        adminUser,
      );

      const filterArg = fileModel.find.mock.calls[0][0];
      expect(filterArg.originalName).toBeDefined();
      expect(filterArg.mimeType).toBe('application/pdf');
      expect(filterArg.accessLevel).toBe('internal');
    });
  });

  // ─── Delete File ────────────────────────────────────

  describe('deleteFile', () => {
    it('should soft delete a file for the owner', async () => {
      const deletableFile = { ...mockFile, save: jest.fn() };
      fileModel.findOne.mockResolvedValueOnce(deletableFile);

      await service.deleteFile('file-uuid-123', normalUser, '127.0.0.1');

      expect(deletableFile.isDeleted).toBe(true);
      expect(deletableFile.deletedBy).toBe('user-id');
      expect(deletableFile.deletedAt).toBeInstanceOf(Date);
      expect(deletableFile.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should allow admin to delete any file', async () => {
      const otherFile = { ...mockFile, uploadedBy: { toString: () => 'other' }, save: jest.fn() };
      fileModel.findOne.mockResolvedValueOnce(otherFile);

      await service.deleteFile('file-uuid-123', adminUser, '127.0.0.1');

      expect(otherFile.isDeleted).toBe(true);
    });

    it('should deny non-owner non-admin from deleting', async () => {
      const otherFile = { ...mockFile, uploadedBy: { toString: () => 'other-user' } };
      fileModel.findOne.mockResolvedValueOnce(otherFile);

      await expect(service.deleteFile('file-uuid-123', normalUser, '127.0.0.1'))
        .rejects.toThrow(ForbiddenException);
    });
  });
});
