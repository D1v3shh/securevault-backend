import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ShareService } from '../services/share.service';
import { FileAccessValidationService } from '../services/file-access-validation.service';
import { FileAccessEntity } from '../schemas/file-access.schema';
import { FileEntity } from '../../files/schemas/file.schema';
import { UserEntity } from '../../users/schemas/user.schema';
import { AuditService } from '../../audit/audit.service';
import { SharePermission, ShareAction } from '../enums/share-permission.enum';
import { ShareStatus } from '../enums/share-status.enum';
import { InvalidShareRequestException } from '../exceptions/invalid-share-request.exception';
import { AccessDeniedException } from '../exceptions/access-denied.exception';
import { ShareExpiredException } from '../exceptions/share-expired.exception';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { Role } from '../../permissions/constants/roles.enum';

/**
 * Integration tests for the file sharing workflow.
 *
 * These tests verify the end-to-end flow across ShareService and
 * FileAccessValidationService working together.
 *
 * Note: These use mock models (not a real DB) to test service integration.
 * For full E2E tests with a real database, use the test/shares.e2e-spec.ts approach.
 */

// ─── Shared State ──────────────────────────────────────
const ownerId = new Types.ObjectId();
const targetUserId = new Types.ObjectId();
const fileMongoId = new Types.ObjectId();

const ownerUser: AuthenticatedUser = {
  userId: ownerId.toString(),
  uuid: 'owner-uuid',
  email: 'owner@test.com',
  role: Role.EMPLOYEE,
};

const targetAuth: AuthenticatedUser = {
  userId: targetUserId.toString(),
  uuid: 'target-uuid',
  email: 'target@test.com',
  role: Role.EMPLOYEE,
};

const mockFile = {
  _id: fileMongoId,
  uuid: 'file-uuid-integration',
  originalName: 'integration-test.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  uploadedBy: ownerId,
  isDeleted: false,
  accessLevel: 'private',
};

const mockTargetUser = {
  _id: targetUserId,
  email: 'target@test.com',
  firstName: 'Target',
  lastName: 'User',
  isActive: true,
  deletedAt: null,
};

// In-memory store to simulate DB
let shareStore: any[] = [];

const createMockModel = () => {
  const model: any = {
    create: jest.fn().mockImplementation(async (data) => {
      const doc = {
        _id: new Types.ObjectId(),
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: jest.fn().mockImplementation(async function (this: any) {
          // Update in store
          const idx = shareStore.findIndex(
            (s) => s._id.toString() === this._id.toString(),
          );
          if (idx !== -1) {
            shareStore[idx] = { ...this };
          }
        }),
      };
      shareStore.push(doc);
      return doc;
    }),
    findOne: jest.fn().mockImplementation(async (filter) => {
      return shareStore.find((s) => {
        if (filter.status && s.status !== filter.status) return false;
        if (filter.fileId && s.fileId?.toString() !== filter.fileId?.toString())
          return false;
        if (
          filter.sharedWithUserId &&
          s.sharedWithUserId?.toString() !== filter.sharedWithUserId?.toString()
        )
          return false;
        return true;
      }) ?? null;
    }),
    findById: jest.fn().mockImplementation(async (id) => {
      return shareStore.find((s) => s._id.toString() === id.toString()) ?? null;
    }),
    find: jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
  return model;
};

describe('Shares Integration Tests', () => {
  let shareService: ShareService;
  let validationService: FileAccessValidationService;
  let fileAccessModel: ReturnType<typeof createMockModel>;
  let fileModel: any;
  let userModel: any;
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    shareStore = [];
    fileAccessModel = createMockModel();
    fileModel = {
      findOne: jest.fn().mockResolvedValue(mockFile),
      findById: jest.fn().mockResolvedValue(mockFile),
    };
    userModel = {
      findById: jest.fn().mockResolvedValue(mockTargetUser),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShareService,
        FileAccessValidationService,
        {
          provide: getModelToken(FileAccessEntity.name),
          useValue: fileAccessModel,
        },
        { provide: getModelToken(FileEntity.name), useValue: fileModel },
        { provide: getModelToken(UserEntity.name), useValue: userModel },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    shareService = module.get<ShareService>(ShareService);
    validationService = module.get<FileAccessValidationService>(
      FileAccessValidationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Full Share Lifecycle ────────────────────────────

  describe('Share Creation → Access Validation → Revocation', () => {
    it('should complete the full share lifecycle', async () => {
      // 1. Create share
      const shareResult = await shareService.shareFile(
        {
          fileId: 'file-uuid-integration',
          sharedWithUserId: targetUserId.toString(),
          permission: SharePermission.DOWNLOAD,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        ownerUser,
        '127.0.0.1',
      );

      expect(shareResult.status).toBe(ShareStatus.ACTIVE);
      expect(shareResult.permission).toBe(SharePermission.DOWNLOAD);
      expect(auditService.log).toHaveBeenCalledTimes(1);

      // 2. Validate access (VIEW — allowed by DOWNLOAD permission)
      const validShare = await validationService.validateAccess(
        fileMongoId.toString(),
        targetUserId.toString(),
        ShareAction.VIEW,
      );
      expect(validShare).toBeDefined();

      // 3. Validate access (DOWNLOAD — exact match)
      const downloadShare = await validationService.validateAccess(
        fileMongoId.toString(),
        targetUserId.toString(),
        ShareAction.DOWNLOAD,
      );
      expect(downloadShare).toBeDefined();

      // 4. Validate access (EDIT — should be denied)
      await expect(
        validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.EDIT,
        ),
      ).rejects.toThrow(AccessDeniedException);

      // 5. Revoke the share
      await shareService.revokeShare(
        shareResult.shareId,
        ownerUser,
        '127.0.0.1',
      );

      // 6. Verify access is now denied
      await expect(
        validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.VIEW,
        ),
      ).rejects.toThrow(AccessDeniedException);
    });
  });

  // ─── Expiration Flow ─────────────────────────────────

  describe('Share Expiration', () => {
    it('should lazily expire on access check', async () => {
      // Create share that will expire immediately
      const shareResult = await shareService.shareFile(
        {
          fileId: 'file-uuid-integration',
          sharedWithUserId: targetUserId.toString(),
          permission: SharePermission.VIEW,
          expiresAt: new Date(Date.now() + 100).toISOString(), // 100ms from now
        },
        ownerUser,
        '127.0.0.1',
      );

      expect(shareResult.status).toBe(ShareStatus.ACTIVE);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Access check should trigger lazy expiration
      await expect(
        validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.VIEW,
        ),
      ).rejects.toThrow(ShareExpiredException);
    });
  });

  // ─── Permission Validation ───────────────────────────

  describe('Permission Hierarchy Validation', () => {
    it('VIEW permission should only allow VIEW', async () => {
      await shareService.shareFile(
        {
          fileId: 'file-uuid-integration',
          sharedWithUserId: targetUserId.toString(),
          permission: SharePermission.VIEW,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        ownerUser,
        '127.0.0.1',
      );

      // VIEW is allowed
      await expect(
        validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.VIEW,
        ),
      ).resolves.toBeDefined();

      // DOWNLOAD is denied
      await expect(
        validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.DOWNLOAD,
        ),
      ).rejects.toThrow(AccessDeniedException);
    });

    it('FULL_ACCESS should allow all actions', async () => {
      await shareService.shareFile(
        {
          fileId: 'file-uuid-integration',
          sharedWithUserId: targetUserId.toString(),
          permission: SharePermission.FULL_ACCESS,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        ownerUser,
        '127.0.0.1',
      );

      for (const action of [
        ShareAction.VIEW,
        ShareAction.DOWNLOAD,
        ShareAction.EDIT,
        ShareAction.DELETE,
        ShareAction.SHARE,
      ]) {
        await expect(
          validationService.validateAccess(
            fileMongoId.toString(),
            targetUserId.toString(),
            action,
          ),
        ).resolves.toBeDefined();
      }
    });
  });

  // ─── Duplicate Prevention ────────────────────────────

  describe('Duplicate Share Prevention', () => {
    it('should prevent creating duplicate active shares', async () => {
      // First share succeeds
      await shareService.shareFile(
        {
          fileId: 'file-uuid-integration',
          sharedWithUserId: targetUserId.toString(),
          permission: SharePermission.VIEW,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        ownerUser,
        '127.0.0.1',
      );

      // Second share should fail
      await expect(
        shareService.shareFile(
          {
            fileId: 'file-uuid-integration',
            sharedWithUserId: targetUserId.toString(),
            permission: SharePermission.DOWNLOAD,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
          ownerUser,
          '127.0.0.1',
        ),
      ).rejects.toThrow(InvalidShareRequestException);
    });
  });

  // ─── Audit Trail ─────────────────────────────────────

  describe('Audit Trail', () => {
    it('should log audit events for share creation and revocation', async () => {
      const shareResult = await shareService.shareFile(
        {
          fileId: 'file-uuid-integration',
          sharedWithUserId: targetUserId.toString(),
          permission: SharePermission.VIEW,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        ownerUser,
        '127.0.0.1',
      );

      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: 'file_access',
          userId: ownerUser.userId,
          status: 'success',
        }),
      );

      // Revoke
      await shareService.revokeShare(
        shareResult.shareId,
        ownerUser,
        '127.0.0.1',
      );

      // 1 for creation + 1 for revocation
      expect(auditService.log).toHaveBeenCalledTimes(2);
    });
  });
});
