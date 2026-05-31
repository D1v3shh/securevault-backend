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
import { ShareExpiredException } from '../exceptions/share-expired.exception';
import { AccessDeniedException } from '../exceptions/access-denied.exception';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { Role } from '../../permissions/constants/roles.enum';

// ─── Test Fixtures ─────────────────────────────────────
const ownerId = new Types.ObjectId();
const targetUserId = new Types.ObjectId();
const fileMongoId = new Types.ObjectId();

const ownerUser: AuthenticatedUser = {
  userId: ownerId.toString(),
  uuid: 'owner-uuid',
  email: 'owner@test.com',
  role: Role.EMPLOYEE,
};

const mockFile = {
  _id: fileMongoId,
  uuid: 'file-uuid-timed',
  originalName: 'timed-share.pdf',
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

const createMockFileAccessModel = () => ({
  create: jest.fn().mockImplementation(async (data) => {
    const doc = {
      _id: new Types.ObjectId(),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
      save: jest.fn().mockImplementation(async function (this: any) {
        const idx = shareStore.findIndex(
          (s) => s._id.toString() === this._id.toString(),
        );
        if (idx !== -1) shareStore[idx] = { ...this };
      }),
    };
    shareStore.push(doc);
    return doc;
  }),
  findOne: jest.fn().mockImplementation(async (filter) => {
    return (
      shareStore.find((s) => {
        if (filter.status && s.status !== filter.status) return false;
        if (filter.fileId && s.fileId?.toString() !== filter.fileId?.toString())
          return false;
        if (
          filter.sharedWithUserId &&
          s.sharedWithUserId?.toString() !== filter.sharedWithUserId?.toString()
        )
          return false;
        return true;
      }) ?? null
    );
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
  updateMany: jest.fn().mockImplementation(async (filter) => {
    let count = 0;
    shareStore.forEach((s) => {
      if (
        s.status === ShareStatus.ACTIVE &&
        filter.expiresAt?.$lt &&
        new Date(s.expiresAt) < filter.expiresAt.$lt
      ) {
        s.status = ShareStatus.EXPIRED;
        count++;
      }
    });
    return { modifiedCount: count };
  }),
});

// ─── Helper ────────────────────────────────────────────
const createShareDto = (overrides: Record<string, any> = {}) => ({
  fileId: 'file-uuid-timed',
  sharedWithUserId: targetUserId.toString(),
  permission: SharePermission.DOWNLOAD,
  expiresAt: new Date(Date.now() + 86400000).toISOString(), // +1 day
  ...overrides,
});

/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  TIME-LIMITED FILE SHARING — COMPREHENSIVE TEST SUITE   ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Tests cover:
 *   1. Expiration date validation at share creation
 *   2. Lazy expiration on access validation
 *   3. Batch expiration of overdue shares
 *   4. isShareValid time-based checks
 *   5. Enterprise controls (download limits, one-time access)
 *      interacting with time-limited behavior
 *   6. Share lifecycle with time boundaries
 */
describe('Time-Limited File Sharing', () => {
  let shareService: ShareService;
  let validationService: FileAccessValidationService;
  let fileAccessModel: ReturnType<typeof createMockFileAccessModel>;
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    shareStore = [];

    fileAccessModel = createMockFileAccessModel();
    const fileModel = {
      findOne: jest.fn().mockResolvedValue(mockFile),
      findById: jest.fn().mockResolvedValue(mockFile),
    };
    const userModel = {
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

  afterEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════════════════════════
  // 1. EXPIRATION DATE VALIDATION AT SHARE CREATION
  // ═══════════════════════════════════════════════════════

  describe('Expiration Date Validation', () => {
    it('should reject a share with expiresAt in the past', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      await expect(
        shareService.shareFile(
          createShareDto({ expiresAt: pastDate }),
          ownerUser,
          '127.0.0.1',
        ),
      ).rejects.toThrow(InvalidShareRequestException);
    });

    it('should reject an invalid date string for expiresAt', async () => {
      await expect(
        shareService.shareFile(
          createShareDto({ expiresAt: 'not-a-date' }),
          ownerUser,
          '127.0.0.1',
        ),
      ).rejects.toThrow(InvalidShareRequestException);
    });

    it('should accept a future expiresAt and store it correctly', async () => {
      const futureDate = new Date(Date.now() + 7200000).toISOString(); // +2 hours
      const result = await shareService.shareFile(
        createShareDto({ expiresAt: futureDate }),
        ownerUser,
        '127.0.0.1',
      );

      expect(result.status).toBe(ShareStatus.ACTIVE);
      expect(new Date(result.expiresAt).getTime()).toBe(
        new Date(futureDate).getTime(),
      );
    });

    it('should accept a far-future expiration (1 year)', async () => {
      const oneYear = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const result = await shareService.shareFile(
        createShareDto({ expiresAt: oneYear }),
        ownerUser,
        '127.0.0.1',
      );

      expect(result.status).toBe(ShareStatus.ACTIVE);
    });

    it('should accept a very short-lived share (1 second)', async () => {
      const shortLived = new Date(Date.now() + 1000).toISOString();
      const result = await shareService.shareFile(
        createShareDto({ expiresAt: shortLived }),
        ownerUser,
        '127.0.0.1',
      );

      expect(result.status).toBe(ShareStatus.ACTIVE);
    });

    it('should include expiresAt in the audit log metadata', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      await shareService.shareFile(
        createShareDto({ expiresAt: futureDate }),
        ownerUser,
        '127.0.0.1',
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            expiresAt: new Date(futureDate).toISOString(),
          }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  // 2. LAZY EXPIRATION ON ACCESS VALIDATION
  // ═══════════════════════════════════════════════════════

  describe('Lazy Expiration on Access Check', () => {
    it('should throw ShareExpiredException after share expires', async () => {
      const result = await shareService.shareFile(
        createShareDto({
          expiresAt: new Date(Date.now() + 100).toISOString(), // 100ms
        }),
        ownerUser,
        '127.0.0.1',
      );

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 200));

      await expect(
        validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.VIEW,
        ),
      ).rejects.toThrow(ShareExpiredException);
    });

    it('should change status to EXPIRED lazily on access', async () => {
      await shareService.shareFile(
        createShareDto({
          expiresAt: new Date(Date.now() + 100).toISOString(),
        }),
        ownerUser,
        '127.0.0.1',
      );

      await new Promise((r) => setTimeout(r, 200));

      try {
        await validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.VIEW,
        );
      } catch {
        // expected
      }

      // Verify the status was updated in the store
      expect(shareStore[0].status).toBe(ShareStatus.EXPIRED);
    });

    it('should log an audit event when lazy-expiring a share', async () => {
      await shareService.shareFile(
        createShareDto({
          expiresAt: new Date(Date.now() + 100).toISOString(),
        }),
        ownerUser,
        '127.0.0.1',
      );

      await new Promise((r) => setTimeout(r, 200));

      try {
        await validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.VIEW,
        );
      } catch {
        // expected
      }

      // Creation audit + expiration audit
      expect(auditService.log).toHaveBeenCalledTimes(2);
      expect(auditService.log).toHaveBeenLastCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ event: 'share_expired' }),
          status: 'success',
        }),
      );
    });

    it('should allow access when share has NOT yet expired', async () => {
      await shareService.shareFile(
        createShareDto({
          expiresAt: new Date(Date.now() + 60000).toISOString(), // +1 min
        }),
        ownerUser,
        '127.0.0.1',
      );

      const share = await validationService.validateAccess(
        fileMongoId.toString(),
        targetUserId.toString(),
        ShareAction.VIEW,
      );

      expect(share).toBeDefined();
      expect(share.status).toBe(ShareStatus.ACTIVE);
    });
  });

  // ═══════════════════════════════════════════════════════
  // 3. BATCH EXPIRATION
  // ═══════════════════════════════════════════════════════

  describe('Batch Expiration (expireOverdueShares)', () => {
    it('should batch-expire shares past their expiresAt', async () => {
      // Create a share that's already expired in store
      shareStore.push({
        _id: new Types.ObjectId(),
        status: ShareStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 86400000), // yesterday
      });

      const count = await validationService.expireOverdueShares();
      expect(count).toBe(1);
      expect(shareStore[0].status).toBe(ShareStatus.EXPIRED);
    });

    it('should NOT expire shares that are still valid', async () => {
      shareStore.push({
        _id: new Types.ObjectId(),
        status: ShareStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 86400000), // tomorrow
      });

      const count = await validationService.expireOverdueShares();
      expect(count).toBe(0);
      expect(shareStore[0].status).toBe(ShareStatus.ACTIVE);
    });

    it('should NOT re-expire already expired shares', async () => {
      shareStore.push({
        _id: new Types.ObjectId(),
        status: ShareStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 86400000),
      });

      const count = await validationService.expireOverdueShares();
      expect(count).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════
  // 4. isShareValid TIME-BASED CHECKS
  // ═══════════════════════════════════════════════════════

  describe('isShareValid (non-throwing time check)', () => {
    it('should return true for a share with future expiration', async () => {
      const result = await shareService.shareFile(
        createShareDto({
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
        ownerUser,
        '127.0.0.1',
      );

      const isValid = await validationService.isShareValid(result.shareId);
      expect(isValid).toBe(true);
    });

    it('should return false and expire for a share past expiration', async () => {
      const result = await shareService.shareFile(
        createShareDto({
          expiresAt: new Date(Date.now() + 50).toISOString(),
        }),
        ownerUser,
        '127.0.0.1',
      );

      await new Promise((r) => setTimeout(r, 150));

      const isValid = await validationService.isShareValid(result.shareId);
      expect(isValid).toBe(false);
      expect(shareStore[0].status).toBe(ShareStatus.EXPIRED);
    });

    it('should return false for a revoked share', async () => {
      const result = await shareService.shareFile(
        createShareDto(),
        ownerUser,
        '127.0.0.1',
      );

      // Revoke it
      await shareService.revokeShare(result.shareId, ownerUser, '127.0.0.1');

      const isValid = await validationService.isShareValid(result.shareId);
      expect(isValid).toBe(false);
    });

    it('should return false for non-existent share ID', async () => {
      const isValid = await validationService.isShareValid(
        new Types.ObjectId().toString(),
      );
      expect(isValid).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════
  // 5. ENTERPRISE CONTROLS + TIME-LIMITING
  // ═══════════════════════════════════════════════════════

  describe('Enterprise Controls with Time Limits', () => {
    it('should enforce download limit before expiration', async () => {
      const result = await shareService.shareFile(
        createShareDto({
          permission: SharePermission.DOWNLOAD,
          maxDownloads: 2,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
        ownerUser,
        '127.0.0.1',
      );

      // Simulate reaching the download limit
      const share = shareStore.find(
        (s) => s._id.toString() === result.shareId,
      );
      share.downloadCount = 2;

      await expect(
        validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.DOWNLOAD,
        ),
      ).rejects.toThrow(AccessDeniedException);
    });

    it('should revoke one-time access share after download via recordDownload', async () => {
      const result = await shareService.shareFile(
        createShareDto({
          permission: SharePermission.DOWNLOAD,
          oneTimeAccess: true,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
        ownerUser,
        '127.0.0.1',
      );

      await validationService.recordDownload(result.shareId);

      const share = shareStore.find(
        (s) => s._id.toString() === result.shareId,
      );
      expect(share.downloadCount).toBe(1);
      expect(share.status).toBe(ShareStatus.REVOKED);
    });

    it('should expire share via recordDownload when maxDownloads reached', async () => {
      const result = await shareService.shareFile(
        createShareDto({
          permission: SharePermission.DOWNLOAD,
          maxDownloads: 1,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
        ownerUser,
        '127.0.0.1',
      );

      await validationService.recordDownload(result.shareId);

      const share = shareStore.find(
        (s) => s._id.toString() === result.shareId,
      );
      expect(share.downloadCount).toBe(1);
      expect(share.status).toBe(ShareStatus.EXPIRED);
    });
  });

  // ═══════════════════════════════════════════════════════
  // 6. FULL SHARE LIFECYCLE WITH TIME BOUNDARIES
  // ═══════════════════════════════════════════════════════

  describe('Full Lifecycle with Time Boundaries', () => {
    it('create → validate → wait for expiry → deny access', async () => {
      // 1. Create with very short expiration
      const result = await shareService.shareFile(
        createShareDto({
          expiresAt: new Date(Date.now() + 100).toISOString(),
        }),
        ownerUser,
        '127.0.0.1',
      );
      expect(result.status).toBe(ShareStatus.ACTIVE);

      // 2. Immediate access should work
      const share = await validationService.validateAccess(
        fileMongoId.toString(),
        targetUserId.toString(),
        ShareAction.VIEW,
      );
      expect(share).toBeDefined();

      // 3. Wait for expiration
      await new Promise((r) => setTimeout(r, 200));

      // 4. Access should now fail
      await expect(
        validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.VIEW,
        ),
      ).rejects.toThrow(ShareExpiredException);

      // 5. isShareValid should also return false
      const isValid = await validationService.isShareValid(result.shareId);
      expect(isValid).toBe(false);
    });

    it('revoke before expiry should deny access immediately', async () => {
      const result = await shareService.shareFile(
        createShareDto({
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
        ownerUser,
        '127.0.0.1',
      );

      // Revoke early
      await shareService.revokeShare(result.shareId, ownerUser, '127.0.0.1');

      // Access should fail (no active share found)
      await expect(
        validationService.validateAccess(
          fileMongoId.toString(),
          targetUserId.toString(),
          ShareAction.VIEW,
        ),
      ).rejects.toThrow(AccessDeniedException);
    });

    it('should prevent re-sharing after revocation until new share is created', async () => {
      // Create and revoke
      const result = await shareService.shareFile(
        createShareDto(),
        ownerUser,
        '127.0.0.1',
      );
      await shareService.revokeShare(result.shareId, ownerUser, '127.0.0.1');

      // New share should work because the old one is revoked (not active)
      const newResult = await shareService.shareFile(
        createShareDto(),
        ownerUser,
        '127.0.0.1',
      );
      expect(newResult.status).toBe(ShareStatus.ACTIVE);
    });
  });
});
