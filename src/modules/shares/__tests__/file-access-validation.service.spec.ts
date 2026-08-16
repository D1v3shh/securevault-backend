import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FileAccessValidationService } from '../services/file-access-validation.service';
import {
  FileAccessEntity,
  FileAccessDocument,
} from '../schemas/file-access.schema';
import { AuditService } from '../../audit/audit.service';
import { SharePermission } from '../enums/share-permission.enum';
import { ShareAction } from '../enums/share-permission.enum';
import { ShareStatus } from '../enums/share-status.enum';
import { AccessDeniedException } from '../exceptions/access-denied.exception';
import { ShareExpiredException } from '../exceptions/share-expired.exception';

// ─── Test Helpers ──────────────────────────────────────
const mockFileId = new Types.ObjectId();
const mockUserId = new Types.ObjectId();
const mockShareId = new Types.ObjectId();

const createMockShare = (overrides: Partial<any> = {}) => ({
  _id: mockShareId,
  fileId: mockFileId,
  ownerId: new Types.ObjectId(),
  sharedWithUserId: mockUserId,
  permission: SharePermission.VIEW,
  status: ShareStatus.ACTIVE,
  sharedAt: new Date(),
  expiresAt: new Date(Date.now() + 86400000), // +1 day
  maxDownloads: null,
  downloadCount: 0,
  oneTimeAccess: false,
  watermarkEnabled: false,
  allowedDeviceCertificateId: null,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const createMockModel = () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  updateMany: jest.fn(),
});

describe('FileAccessValidationService', () => {
  let service: FileAccessValidationService;
  let fileAccessModel: ReturnType<typeof createMockModel>;
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    fileAccessModel = createMockModel();
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileAccessValidationService,
        {
          provide: getModelToken(FileAccessEntity.name),
          useValue: fileAccessModel,
        },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<FileAccessValidationService>(
      FileAccessValidationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── validateAccess ──────────────────────────────────

  describe('validateAccess', () => {
    it('should return share when access is valid (VIEW action, VIEW permission)', async () => {
      const share = createMockShare();
      fileAccessModel.findOne.mockResolvedValue(share);

      const result = await service.validateAccess(
        mockFileId.toString(),
        mockUserId.toString(),
        ShareAction.VIEW,
      );

      expect(result).toBe(share);
    });

    it('should throw AccessDeniedException when no active share exists', async () => {
      fileAccessModel.findOne.mockResolvedValue(null);

      await expect(
        service.validateAccess(
          mockFileId.toString(),
          mockUserId.toString(),
          ShareAction.VIEW,
        ),
      ).rejects.toThrow(AccessDeniedException);

      expect(auditService.log).toHaveBeenCalledTimes(1);
    });

    it('should lazily expire and throw ShareExpiredException when share is past expiration', async () => {
      const expiredShare = createMockShare({
        expiresAt: new Date(Date.now() - 86400000), // yesterday
      });
      fileAccessModel.findOne.mockResolvedValue(expiredShare);

      await expect(
        service.validateAccess(
          mockFileId.toString(),
          mockUserId.toString(),
          ShareAction.VIEW,
        ),
      ).rejects.toThrow(ShareExpiredException);

      expect(expiredShare.status).toBe(ShareStatus.EXPIRED);
      expect(expiredShare.save).toHaveBeenCalledTimes(1);
    });

    it('should throw AccessDeniedException when permission is insufficient', async () => {
      const viewOnlyShare = createMockShare({
        permission: SharePermission.VIEW,
      });
      fileAccessModel.findOne.mockResolvedValue(viewOnlyShare);

      await expect(
        service.validateAccess(
          mockFileId.toString(),
          mockUserId.toString(),
          ShareAction.DOWNLOAD, // Requires DOWNLOAD permission
        ),
      ).rejects.toThrow(AccessDeniedException);
    });

    it('should allow DOWNLOAD action with DOWNLOAD permission', async () => {
      const share = createMockShare({
        permission: SharePermission.DOWNLOAD,
      });
      fileAccessModel.findOne.mockResolvedValue(share);

      const result = await service.validateAccess(
        mockFileId.toString(),
        mockUserId.toString(),
        ShareAction.DOWNLOAD,
      );

      expect(result).toBe(share);
    });

    it('should allow DOWNLOAD action with FULL_ACCESS permission', async () => {
      const share = createMockShare({
        permission: SharePermission.FULL_ACCESS,
      });
      fileAccessModel.findOne.mockResolvedValue(share);

      const result = await service.validateAccess(
        mockFileId.toString(),
        mockUserId.toString(),
        ShareAction.DOWNLOAD,
      );

      expect(result).toBe(share);
    });

    it('should throw AccessDeniedException when download limit is reached', async () => {
      const share = createMockShare({
        permission: SharePermission.DOWNLOAD,
        maxDownloads: 5,
        downloadCount: 5,
      });
      fileAccessModel.findOne.mockResolvedValue(share);

      await expect(
        service.validateAccess(
          mockFileId.toString(),
          mockUserId.toString(),
          ShareAction.DOWNLOAD,
        ),
      ).rejects.toThrow(AccessDeniedException);
    });

    it('should allow download when under the limit', async () => {
      const share = createMockShare({
        permission: SharePermission.DOWNLOAD,
        maxDownloads: 5,
        downloadCount: 3,
      });
      fileAccessModel.findOne.mockResolvedValue(share);

      const result = await service.validateAccess(
        mockFileId.toString(),
        mockUserId.toString(),
        ShareAction.DOWNLOAD,
      );

      expect(result).toBe(share);
    });

    it('should throw AccessDeniedException when device certificate does not match', async () => {
      const share = createMockShare({
        allowedDeviceCertificateId: 'device-cert-123',
      });
      fileAccessModel.findOne.mockResolvedValue(share);

      await expect(
        service.validateAccess(
          mockFileId.toString(),
          mockUserId.toString(),
          ShareAction.VIEW,
          'wrong-cert-id',
        ),
      ).rejects.toThrow(AccessDeniedException);
    });

    it('should throw AccessDeniedException when device certificate is missing but required', async () => {
      const share = createMockShare({
        allowedDeviceCertificateId: 'device-cert-123',
      });
      fileAccessModel.findOne.mockResolvedValue(share);

      await expect(
        service.validateAccess(
          mockFileId.toString(),
          mockUserId.toString(),
          ShareAction.VIEW,
          // No device cert provided
        ),
      ).rejects.toThrow(AccessDeniedException);
    });

    it('should pass when device certificate matches', async () => {
      const share = createMockShare({
        allowedDeviceCertificateId: 'device-cert-123',
      });
      fileAccessModel.findOne.mockResolvedValue(share);

      const result = await service.validateAccess(
        mockFileId.toString(),
        mockUserId.toString(),
        ShareAction.VIEW,
        'device-cert-123',
      );

      expect(result).toBe(share);
    });
  });

  // ─── recordDownload ──────────────────────────────────

  describe('recordDownload', () => {
    it('should increment download count', async () => {
      const share = createMockShare({ downloadCount: 2 });
      fileAccessModel.findById.mockResolvedValue(share);

      await service.recordDownload(mockShareId.toString());

      expect(share.downloadCount).toBe(3);
      expect(share.save).toHaveBeenCalledTimes(1);
    });

    it('should revoke one-time access share after download', async () => {
      const share = createMockShare({
        downloadCount: 0,
        oneTimeAccess: true,
      });
      fileAccessModel.findById.mockResolvedValue(share);

      await service.recordDownload(mockShareId.toString());

      expect(share.downloadCount).toBe(1);
      expect(share.status).toBe(ShareStatus.REVOKED);
      expect(share.save).toHaveBeenCalledTimes(1);
    });

    it('should expire share when download limit is reached', async () => {
      const share = createMockShare({
        downloadCount: 4,
        maxDownloads: 5,
      });
      fileAccessModel.findById.mockResolvedValue(share);

      await service.recordDownload(mockShareId.toString());

      expect(share.downloadCount).toBe(5);
      expect(share.status).toBe(ShareStatus.EXPIRED);
    });

    it('should do nothing if share not found', async () => {
      fileAccessModel.findById.mockResolvedValue(null);

      await expect(
        service.recordDownload('nonexistent'),
      ).resolves.not.toThrow();
    });
  });

  // ─── isShareValid ────────────────────────────────────

  describe('isShareValid', () => {
    it('should return true for valid active share', async () => {
      const share = createMockShare();
      fileAccessModel.findById.mockResolvedValue(share);

      const result = await service.isShareValid(mockShareId.toString());
      expect(result).toBe(true);
    });

    it('should return false for non-existent share', async () => {
      fileAccessModel.findById.mockResolvedValue(null);

      const result = await service.isShareValid('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false and lazily expire if past expiration', async () => {
      const share = createMockShare({
        expiresAt: new Date(Date.now() - 86400000),
      });
      fileAccessModel.findById.mockResolvedValue(share);

      const result = await service.isShareValid(mockShareId.toString());

      expect(result).toBe(false);
      expect(share.status).toBe(ShareStatus.EXPIRED);
      expect(share.save).toHaveBeenCalledTimes(1);
    });

    it('should return false for revoked share', async () => {
      const share = createMockShare({ status: ShareStatus.REVOKED });
      fileAccessModel.findById.mockResolvedValue(share);

      const result = await service.isShareValid(mockShareId.toString());
      expect(result).toBe(false);
    });
  });

  // ─── expireOverdueShares ─────────────────────────────

  describe('expireOverdueShares', () => {
    it('should update overdue shares to EXPIRED', async () => {
      fileAccessModel.updateMany.mockResolvedValue({ modifiedCount: 3 });

      const count = await service.expireOverdueShares();

      expect(count).toBe(3);
      expect(fileAccessModel.updateMany).toHaveBeenCalledWith(
        {
          status: ShareStatus.ACTIVE,
          expiresAt: { $lt: expect.any(Date) },
        },
        {
          $set: { status: ShareStatus.EXPIRED },
        },
      );
    });

    it('should return 0 when no shares are overdue', async () => {
      fileAccessModel.updateMany.mockResolvedValue({ modifiedCount: 0 });

      const count = await service.expireOverdueShares();
      expect(count).toBe(0);
    });
  });
});
