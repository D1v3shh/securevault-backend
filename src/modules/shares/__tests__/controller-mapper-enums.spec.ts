import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ShareController } from '../share.controller';
import { ShareService } from '../services/share.service';
import { SharePermission } from '../enums/share-permission.enum';
import { ShareStatus } from '../enums/share-status.enum';
import {
  hasPermissionForAction,
  ShareAction,
  SHARE_PERMISSION_HIERARCHY,
  ACTION_REQUIRED_PERMISSION,
} from '../enums/share-permission.enum';
import { ShareMapper } from '../mappers/share.mapper';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { Role } from '../../permissions/constants/roles.enum';

// ─── Fixtures ──────────────────────────────────────────
const ownerId = new Types.ObjectId();
const targetUserId = new Types.ObjectId();
const fileId = new Types.ObjectId();
const shareId = new Types.ObjectId();

const mockUser: AuthenticatedUser = {
  userId: ownerId.toString(),
  uuid: 'ctrl-owner-uuid',
  email: 'ctrl-owner@test.com',
  role: Role.EMPLOYEE,
};

const mockReq: any = { ip: '192.168.1.1', socket: { remoteAddress: '192.168.1.1' } };

// ═══════════════════════════════════════════════════════
// CONTROLLER TESTS
// ═══════════════════════════════════════════════════════

describe('ShareController', () => {
  let controller: ShareController;
  let shareService: Record<string, jest.Mock>;

  beforeEach(async () => {
    shareService = {
      shareFile: jest.fn(),
      revokeShare: jest.fn(),
      getSharedWithMe: jest.fn(),
      getSharedByMe: jest.fn(),
      getShareById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShareController],
      providers: [{ provide: ShareService, useValue: shareService }],
    }).compile();

    controller = module.get<ShareController>(ShareController);
  });

  describe('shareFile', () => {
    it('should delegate to service with correct args', async () => {
      const dto = {
        fileId: 'file-uuid',
        sharedWithUserId: targetUserId.toString(),
        permission: SharePermission.VIEW,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      const expectedResponse = {
        shareId: shareId.toString(),
        permission: SharePermission.VIEW,
        status: ShareStatus.ACTIVE,
        expiresAt: dto.expiresAt,
      };
      shareService.shareFile.mockResolvedValue(expectedResponse);

      const result = await controller.shareFile(dto, mockUser, mockReq);

      expect(result).toEqual(expectedResponse);
      expect(shareService.shareFile).toHaveBeenCalledWith(dto, mockUser, '192.168.1.1');
    });

    it('should pass enterprise control fields through', async () => {
      const dto = {
        fileId: 'file-uuid',
        sharedWithUserId: targetUserId.toString(),
        permission: SharePermission.DOWNLOAD,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        maxDownloads: 3,
        oneTimeAccess: true,
        watermarkEnabled: true,
      };
      shareService.shareFile.mockResolvedValue({ shareId: 'id' });

      await controller.shareFile(dto, mockUser, mockReq);

      expect(shareService.shareFile).toHaveBeenCalledWith(
        expect.objectContaining({
          maxDownloads: 3,
          oneTimeAccess: true,
          watermarkEnabled: true,
        }),
        mockUser,
        '192.168.1.1',
      );
    });
  });

  describe('revokeShare', () => {
    it('should return success message', async () => {
      shareService.revokeShare.mockResolvedValue(undefined);

      const result = await controller.revokeShare(shareId.toString(), mockUser, mockReq);

      expect(result).toEqual({ message: 'Share revoked successfully' });
      expect(shareService.revokeShare).toHaveBeenCalledWith(
        shareId.toString(),
        mockUser,
        '192.168.1.1',
      );
    });
  });

  describe('getSharedWithMe', () => {
    it('should delegate to service with query', async () => {
      const mockResult = { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNextPage: false, hasPreviousPage: false } };
      shareService.getSharedWithMe.mockResolvedValue(mockResult);

      const result = await controller.getSharedWithMe({ page: 1, limit: 20 }, mockUser);

      expect(result).toEqual(mockResult);
    });
  });

  describe('getSharedByMe', () => {
    it('should delegate to service with query', async () => {
      const mockResult = { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNextPage: false, hasPreviousPage: false } };
      shareService.getSharedByMe.mockResolvedValue(mockResult);

      const result = await controller.getSharedByMe({ page: 1, limit: 20 }, mockUser);

      expect(result).toEqual(mockResult);
    });
  });

  describe('getShareById', () => {
    it('should delegate to service', async () => {
      const mockShare = { shareId: shareId.toString(), status: ShareStatus.ACTIVE };
      shareService.getShareById.mockResolvedValue(mockShare);

      const result = await controller.getShareById(shareId.toString(), mockUser);

      expect(result).toEqual(mockShare);
    });
  });
});

// ═══════════════════════════════════════════════════════
// MAPPER TESTS
// ═══════════════════════════════════════════════════════

describe('ShareMapper', () => {
  const now = new Date();
  const futureDate = new Date(Date.now() + 86400000);

  describe('toShareFileResponse', () => {
    it('should map all fields including time fields', () => {
      const doc: any = {
        _id: shareId,
        fileId,
        ownerId,
        sharedWithUserId: targetUserId,
        permission: SharePermission.DOWNLOAD,
        status: ShareStatus.ACTIVE,
        sharedAt: now,
        expiresAt: futureDate,
        maxDownloads: 5,
        oneTimeAccess: false,
        watermarkEnabled: true,
        createdAt: now,
      };

      const result = ShareMapper.toShareFileResponse(doc);

      expect(result.shareId).toBe(shareId.toString());
      expect(result.expiresAt).toBe(futureDate.toISOString());
      expect(result.sharedAt).toBe(now.toISOString());
      expect(result.status).toBe(ShareStatus.ACTIVE);
      expect(result.maxDownloads).toBe(5);
      expect(result.watermarkEnabled).toBe(true);
    });

    it('should fallback createdAt to sharedAt if missing', () => {
      const doc: any = {
        _id: shareId,
        fileId,
        ownerId,
        sharedWithUserId: targetUserId,
        permission: SharePermission.VIEW,
        status: ShareStatus.ACTIVE,
        sharedAt: now,
        expiresAt: futureDate,
        maxDownloads: null,
        oneTimeAccess: false,
        watermarkEnabled: false,
      };

      const result = ShareMapper.toShareFileResponse(doc);
      expect(result.createdAt).toBe(now.toISOString());
    });
  });

  describe('toSharedFileResponse', () => {
    it('should map populated document including expiration fields', () => {
      const doc: any = {
        _id: shareId,
        fileId: { _id: fileId, uuid: 'f-uuid', originalName: 'doc.pdf', mimeType: 'application/pdf', size: 1024 },
        ownerId: { _id: ownerId, email: 'owner@test.com', firstName: 'O', lastName: 'W' },
        sharedWithUserId: { _id: targetUserId, email: 'target@test.com', firstName: 'T', lastName: 'U' },
        permission: SharePermission.DOWNLOAD,
        status: ShareStatus.ACTIVE,
        sharedAt: now,
        expiresAt: futureDate,
        maxDownloads: null,
        downloadCount: 3,
        oneTimeAccess: false,
        watermarkEnabled: false,
        createdAt: now,
      };

      const result = ShareMapper.toSharedFileResponse(doc);

      expect(result.shareId).toBe(shareId.toString());
      expect(result.file.originalName).toBe('doc.pdf');
      expect(result.owner.email).toBe('owner@test.com');
      expect(result.sharedWith.email).toBe('target@test.com');
      expect(result.expiresAt).toBe(futureDate.toISOString());
      expect(result.downloadCount).toBe(3);
    });

    it('should handle null/missing populated fields gracefully', () => {
      const doc: any = {
        _id: shareId,
        fileId: null,
        ownerId: null,
        sharedWithUserId: null,
        permission: SharePermission.VIEW,
        status: ShareStatus.EXPIRED,
        sharedAt: now,
        expiresAt: now,
        maxDownloads: null,
        downloadCount: 0,
        oneTimeAccess: false,
        watermarkEnabled: false,
        createdAt: now,
      };

      const result = ShareMapper.toSharedFileResponse(doc);

      expect(result.file.fileId).toBe('');
      expect(result.owner.userId).toBe('');
      expect(result.sharedWith.userId).toBe('');
    });
  });

  describe('toSharedFileResponseList', () => {
    it('should map an array of docs', () => {
      const docs = [
        {
          _id: new Types.ObjectId(),
          fileId: { uuid: 'a', originalName: 'a.pdf', mimeType: 'application/pdf', size: 100 },
          ownerId: { _id: ownerId, email: 'o@t.com', firstName: 'O', lastName: 'L' },
          sharedWithUserId: { _id: targetUserId, email: 't@t.com', firstName: 'T', lastName: 'L' },
          permission: SharePermission.VIEW,
          status: ShareStatus.ACTIVE,
          sharedAt: now,
          expiresAt: futureDate,
          maxDownloads: null,
          downloadCount: 0,
          oneTimeAccess: false,
          watermarkEnabled: false,
          createdAt: now,
        },
      ];

      const result = ShareMapper.toSharedFileResponseList(docs);
      expect(result).toHaveLength(1);
      expect(result[0].file.originalName).toBe('a.pdf');
    });
  });
});

// ═══════════════════════════════════════════════════════
// PERMISSION HIERARCHY TESTS
// ═══════════════════════════════════════════════════════

describe('Permission Hierarchy', () => {
  it('VIEW should only allow VIEW action', () => {
    expect(hasPermissionForAction(SharePermission.VIEW, ShareAction.VIEW)).toBe(true);
    expect(hasPermissionForAction(SharePermission.VIEW, ShareAction.DOWNLOAD)).toBe(false);
    expect(hasPermissionForAction(SharePermission.VIEW, ShareAction.EDIT)).toBe(false);
    expect(hasPermissionForAction(SharePermission.VIEW, ShareAction.DELETE)).toBe(false);
    expect(hasPermissionForAction(SharePermission.VIEW, ShareAction.SHARE)).toBe(false);
  });

  it('DOWNLOAD should allow VIEW and DOWNLOAD', () => {
    expect(hasPermissionForAction(SharePermission.DOWNLOAD, ShareAction.VIEW)).toBe(true);
    expect(hasPermissionForAction(SharePermission.DOWNLOAD, ShareAction.DOWNLOAD)).toBe(true);
    expect(hasPermissionForAction(SharePermission.DOWNLOAD, ShareAction.EDIT)).toBe(false);
  });

  it('EDIT should allow VIEW, DOWNLOAD, and EDIT', () => {
    expect(hasPermissionForAction(SharePermission.EDIT, ShareAction.VIEW)).toBe(true);
    expect(hasPermissionForAction(SharePermission.EDIT, ShareAction.DOWNLOAD)).toBe(true);
    expect(hasPermissionForAction(SharePermission.EDIT, ShareAction.EDIT)).toBe(true);
    expect(hasPermissionForAction(SharePermission.EDIT, ShareAction.DELETE)).toBe(false);
  });

  it('FULL_ACCESS should allow all actions', () => {
    for (const action of Object.values(ShareAction)) {
      expect(hasPermissionForAction(SharePermission.FULL_ACCESS, action)).toBe(true);
    }
  });

  it('hierarchy weights should be in ascending order', () => {
    expect(SHARE_PERMISSION_HIERARCHY[SharePermission.VIEW]).toBeLessThan(
      SHARE_PERMISSION_HIERARCHY[SharePermission.DOWNLOAD],
    );
    expect(SHARE_PERMISSION_HIERARCHY[SharePermission.DOWNLOAD]).toBeLessThan(
      SHARE_PERMISSION_HIERARCHY[SharePermission.EDIT],
    );
    expect(SHARE_PERMISSION_HIERARCHY[SharePermission.EDIT]).toBeLessThan(
      SHARE_PERMISSION_HIERARCHY[SharePermission.FULL_ACCESS],
    );
  });

  it('all actions should have a required permission mapping', () => {
    for (const action of Object.values(ShareAction)) {
      expect(ACTION_REQUIRED_PERMISSION[action]).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════
// EXCEPTION TESTS
// ═══════════════════════════════════════════════════════

describe('Custom Exceptions', () => {
  it('AccessDeniedException should be 403', () => {
    const { AccessDeniedException } = require('../exceptions/access-denied.exception');
    const ex = new AccessDeniedException();
    expect(ex.getStatus()).toBe(403);
  });

  it('AccessDeniedException should accept custom message', () => {
    const { AccessDeniedException } = require('../exceptions/access-denied.exception');
    const ex = new AccessDeniedException('Custom denial');
    expect(ex.getResponse()).toEqual(
      expect.objectContaining({ message: 'Custom denial' }),
    );
  });

  it('InvalidShareRequestException should be 400', () => {
    const { InvalidShareRequestException } = require('../exceptions/invalid-share-request.exception');
    const ex = new InvalidShareRequestException('bad request');
    expect(ex.getStatus()).toBe(400);
  });

  it('ShareExpiredException should be 410 (Gone)', () => {
    const { ShareExpiredException } = require('../exceptions/share-expired.exception');
    const ex = new ShareExpiredException();
    expect(ex.getStatus()).toBe(410);
  });

  it('ShareNotFoundException should be 404', () => {
    const { ShareNotFoundException } = require('../exceptions/share-not-found.exception');
    const ex = new ShareNotFoundException();
    expect(ex.getStatus()).toBe(404);
  });
});
