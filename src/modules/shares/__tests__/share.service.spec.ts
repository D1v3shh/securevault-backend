import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ShareService } from '../services/share.service';
import { FileAccessEntity, FileAccessDocument } from '../schemas/file-access.schema';
import { FileEntity, FileDocument } from '../../files/schemas/file.schema';
import { UserEntity, UserDocument } from '../../users/schemas/user.schema';
import { AuditService } from '../../audit/audit.service';
import { SharePermission } from '../enums/share-permission.enum';
import { ShareStatus } from '../enums/share-status.enum';
import { InvalidShareRequestException } from '../exceptions/invalid-share-request.exception';
import { AccessDeniedException } from '../exceptions/access-denied.exception';
import { ShareNotFoundException } from '../exceptions/share-not-found.exception';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { Role } from '../../permissions/constants/roles.enum';

// ─── Test Helpers ──────────────────────────────────────
const mockOwnerId = new Types.ObjectId();
const mockTargetUserId = new Types.ObjectId();
const mockFileId = new Types.ObjectId();

const mockUser: AuthenticatedUser = {
  userId: mockOwnerId.toString(),
  uuid: 'owner-uuid',
  email: 'owner@company.com',
  role: Role.EMPLOYEE,
};

const mockFile = {
  _id: mockFileId,
  uuid: 'file-uuid-123',
  originalName: 'report.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  uploadedBy: mockOwnerId,
  isDeleted: false,
  accessLevel: 'private',
};

const mockTargetUser = {
  _id: mockTargetUserId,
  email: 'target@company.com',
  firstName: 'John',
  lastName: 'Doe',
  isActive: true,
  deletedAt: null,
};

const mockShareDoc = {
  _id: new Types.ObjectId(),
  fileId: mockFileId,
  ownerId: mockOwnerId,
  sharedWithUserId: mockTargetUserId,
  permission: SharePermission.VIEW,
  status: ShareStatus.ACTIVE,
  sharedAt: new Date(),
  expiresAt: new Date(Date.now() + 86400000), // +1 day
  maxDownloads: null,
  downloadCount: 0,
  oneTimeAccess: false,
  watermarkEnabled: false,
  allowedDeviceCertificateId: null,
  createdAt: new Date(),
  save: jest.fn().mockResolvedValue(undefined),
};

// ─── Mock factories ────────────────────────────────────
const createMockModel = () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
  updateMany: jest.fn(),
});

describe('ShareService', () => {
  let service: ShareService;
  let fileAccessModel: ReturnType<typeof createMockModel>;
  let fileModel: ReturnType<typeof createMockModel>;
  let userModel: ReturnType<typeof createMockModel>;
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    fileAccessModel = createMockModel();
    fileModel = createMockModel();
    userModel = createMockModel();
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShareService,
        { provide: getModelToken(FileAccessEntity.name), useValue: fileAccessModel },
        { provide: getModelToken(FileEntity.name), useValue: fileModel },
        { provide: getModelToken(UserEntity.name), useValue: userModel },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<ShareService>(ShareService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Share File ──────────────────────────────────────

  describe('shareFile', () => {
    const validDto = {
      fileId: 'file-uuid-123',
      sharedWithUserId: mockTargetUserId.toString(),
      permission: SharePermission.VIEW,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };

    it('should create a share successfully', async () => {
      fileModel.findOne.mockResolvedValue(mockFile);
      userModel.findById.mockResolvedValue(mockTargetUser);
      fileAccessModel.findOne.mockResolvedValue(null);
      fileAccessModel.create.mockResolvedValue(mockShareDoc);

      const result = await service.shareFile(validDto, mockUser, '127.0.0.1');

      expect(result.shareId).toBeDefined();
      expect(result.permission).toBe(SharePermission.VIEW);
      expect(result.status).toBe(ShareStatus.ACTIVE);
      expect(fileAccessModel.create).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledTimes(1);
    });

    it('should throw if file not found', async () => {
      fileModel.findOne.mockResolvedValue(null);
      fileModel.findById.mockResolvedValue(null);

      await expect(
        service.shareFile(validDto, mockUser, '127.0.0.1'),
      ).rejects.toThrow(InvalidShareRequestException);
    });

    it('should throw if file is deleted', async () => {
      fileModel.findOne.mockResolvedValue({ ...mockFile, isDeleted: true });

      await expect(
        service.shareFile(validDto, mockUser, '127.0.0.1'),
      ).rejects.toThrow(InvalidShareRequestException);
    });

    it('should throw if requesting user is not the file owner', async () => {
      const nonOwnerUser = { ...mockUser, userId: new Types.ObjectId().toString() };
      fileModel.findOne.mockResolvedValue(mockFile);

      await expect(
        service.shareFile(validDto, nonOwnerUser, '127.0.0.1'),
      ).rejects.toThrow(AccessDeniedException);
    });

    it('should throw if target user not found', async () => {
      fileModel.findOne.mockResolvedValue(mockFile);
      userModel.findById.mockResolvedValue(null);

      await expect(
        service.shareFile(validDto, mockUser, '127.0.0.1'),
      ).rejects.toThrow(InvalidShareRequestException);
    });

    it('should throw if target user is inactive', async () => {
      fileModel.findOne.mockResolvedValue(mockFile);
      userModel.findById.mockResolvedValue({ ...mockTargetUser, isActive: false });

      await expect(
        service.shareFile(validDto, mockUser, '127.0.0.1'),
      ).rejects.toThrow(InvalidShareRequestException);
    });

    it('should throw if sharing with self', async () => {
      fileModel.findOne.mockResolvedValue(mockFile);
      userModel.findById.mockResolvedValue({
        ...mockTargetUser,
        _id: mockOwnerId,
      });

      await expect(
        service.shareFile(
          { ...validDto, sharedWithUserId: mockOwnerId.toString() },
          mockUser,
          '127.0.0.1',
        ),
      ).rejects.toThrow(InvalidShareRequestException);
    });

    it('should throw if expiration is in the past', async () => {
      fileModel.findOne.mockResolvedValue(mockFile);
      userModel.findById.mockResolvedValue(mockTargetUser);

      await expect(
        service.shareFile(
          { ...validDto, expiresAt: '2020-01-01T00:00:00Z' },
          mockUser,
          '127.0.0.1',
        ),
      ).rejects.toThrow(InvalidShareRequestException);
    });

    it('should throw if duplicate active share exists', async () => {
      fileModel.findOne.mockResolvedValue(mockFile);
      userModel.findById.mockResolvedValue(mockTargetUser);
      fileAccessModel.findOne.mockResolvedValue(mockShareDoc);

      await expect(
        service.shareFile(validDto, mockUser, '127.0.0.1'),
      ).rejects.toThrow(InvalidShareRequestException);
    });
  });

  // ─── Revoke Share ────────────────────────────────────

  describe('revokeShare', () => {
    it('should revoke a share successfully', async () => {
      const shareToRevoke = {
        ...mockShareDoc,
        ownerId: mockOwnerId,
        status: ShareStatus.ACTIVE,
        save: jest.fn().mockResolvedValue(undefined),
      };
      fileAccessModel.findById.mockResolvedValue(shareToRevoke);

      await service.revokeShare(
        shareToRevoke._id.toString(),
        mockUser,
        '127.0.0.1',
      );

      expect(shareToRevoke.status).toBe(ShareStatus.REVOKED);
      expect(shareToRevoke.save).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledTimes(1);
    });

    it('should throw if share not found', async () => {
      fileAccessModel.findById.mockResolvedValue(null);

      await expect(
        service.revokeShare('nonexistent-id', mockUser, '127.0.0.1'),
      ).rejects.toThrow(ShareNotFoundException);
    });

    it('should throw if non-owner tries to revoke', async () => {
      const otherUser = { ...mockUser, userId: new Types.ObjectId().toString() };
      fileAccessModel.findById.mockResolvedValue(mockShareDoc);

      await expect(
        service.revokeShare(mockShareDoc._id.toString(), otherUser, '127.0.0.1'),
      ).rejects.toThrow(AccessDeniedException);
    });

    it('should throw if share is already revoked', async () => {
      const revokedShare = {
        ...mockShareDoc,
        ownerId: mockOwnerId,
        status: ShareStatus.REVOKED,
      };
      fileAccessModel.findById.mockResolvedValue(revokedShare);

      await expect(
        service.revokeShare(revokedShare._id.toString(), mockUser, '127.0.0.1'),
      ).rejects.toThrow(InvalidShareRequestException);
    });
  });

  // ─── List Shares ─────────────────────────────────────

  describe('getSharedWithMe', () => {
    it('should return paginated results', async () => {
      const mockPopulate = {
        find: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };

      fileAccessModel.find.mockReturnValue(mockPopulate);
      fileAccessModel.countDocuments.mockResolvedValue(0);

      const result = await service.getSharedWithMe(
        { page: 1, limit: 20 },
        mockUser,
      );

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.page).toBe(1);
    });
  });

  describe('getSharedByMe', () => {
    it('should return paginated results', async () => {
      const mockPopulate = {
        find: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };

      fileAccessModel.find.mockReturnValue(mockPopulate);
      fileAccessModel.countDocuments.mockResolvedValue(0);

      const result = await service.getSharedByMe(
        { page: 1, limit: 20 },
        mockUser,
      );

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  // ─── Get Share by ID ──────────────────────────────────

  describe('getShareById', () => {
    it('should throw if share not found', async () => {
      const mockPopulate = {
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      };
      fileAccessModel.findById.mockReturnValue(mockPopulate);

      await expect(
        service.getShareById('nonexistent', mockUser),
      ).rejects.toThrow(ShareNotFoundException);
    });

    it('should throw if user is neither owner nor shared-with', async () => {
      const otherUser = { ...mockUser, userId: new Types.ObjectId().toString() };
      const shareWithPopulated = {
        ...mockShareDoc,
        ownerId: { _id: mockOwnerId },
        sharedWithUserId: { _id: mockTargetUserId },
      };

      const mockPopulate = {
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(shareWithPopulated),
      };
      fileAccessModel.findById.mockReturnValue(mockPopulate);

      await expect(
        service.getShareById(mockShareDoc._id.toString(), otherUser),
      ).rejects.toThrow(AccessDeniedException);
    });
  });
});
