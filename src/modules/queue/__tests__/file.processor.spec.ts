import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FileProcessor } from '../processors/file.processor';
import { FileEntity } from '../../files/schemas/file.schema';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '../../audit/interfaces/audit.interface';
import { APP_CONSTANTS } from '../../../shared/constants/app.constants';

const buildExpiredFile = (index: number) => ({
  _id: new Types.ObjectId(),
  uuid: `file-uuid-${index}`,
  originalName: `old-${index}.pdf`,
  storagePath: `2026/01/01/file-uuid-${index}.pdf`,
  size: 1000 + index,
  isDeleted: true,
  deletedAt: new Date(Date.now() - 40 * 86400000),
  deletedBy: 'user-1',
});

describe('FileProcessor.cleanupExpiredFiles', () => {
  let processor: FileProcessor;
  let fileModel: { find: jest.Mock; deleteOne: jest.Mock };
  let storageService: { exists: jest.Mock; delete: jest.Mock };
  let auditService: { log: jest.Mock };
  let findChain: { limit: jest.Mock; exec: jest.Mock };

  /** Stub the find().limit().exec() chain with `count` expired files. */
  const withExpiredFiles = (count: number) => {
    const files = Array.from({ length: count }, (_, i) => buildExpiredFile(i));
    findChain.exec.mockResolvedValue(files);
    return files;
  };

  beforeEach(async () => {
    findChain = {
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    fileModel = {
      find: jest.fn().mockReturnValue(findChain),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    storageService = {
      exists: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileProcessor,
        { provide: getModelToken(FileEntity.name), useValue: fileModel },
        { provide: StorageService, useValue: storageService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    processor = module.get<FileProcessor>(FileProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Dry run must not touch anything ─────────────────

  it('should delete nothing on a dry run', async () => {
    withExpiredFiles(3);

    const result = await processor.cleanupExpiredFiles({ dryRun: true });

    expect(result).toMatchObject({ dryRun: true, scanned: 3, deleted: 0 });
    expect(result.uuids).toEqual(['file-uuid-0', 'file-uuid-1', 'file-uuid-2']);

    expect(storageService.delete).not.toHaveBeenCalled();
    expect(fileModel.deleteOne).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  // ─── Confirmed run ───────────────────────────────────

  it('should purge blob and metadata when not a dry run', async () => {
    const files = withExpiredFiles(2);

    const result = await processor.cleanupExpiredFiles({ dryRun: false });

    expect(result).toMatchObject({
      dryRun: false,
      scanned: 2,
      deleted: 2,
      errors: 0,
    });
    expect(storageService.delete).toHaveBeenCalledTimes(2);
    expect(storageService.delete).toHaveBeenCalledWith(files[0].storagePath);
    expect(fileModel.deleteOne).toHaveBeenCalledWith({ _id: files[0]._id });
  });

  it('should write the audit row before deleting, since the row is about to vanish', async () => {
    const files = withExpiredFiles(1);
    const order: string[] = [];
    auditService.log.mockImplementation(() => {
      order.push('audit');
      return Promise.resolve();
    });
    fileModel.deleteOne.mockImplementation(() => {
      order.push('deleteOne');
      return Promise.resolve({ deletedCount: 1 });
    });
    storageService.delete.mockImplementation(() => {
      order.push('storageDelete');
      return Promise.resolve();
    });

    await processor.cleanupExpiredFiles({ dryRun: false });

    expect(order).toEqual(['audit', 'storageDelete', 'deleteOne']);

    const [event] = auditService.log.mock.calls[0] as [
      {
        action: AuditAction;
        resourceId: string;
        userId: string;
        metadata: any;
      },
    ];
    expect(event.action).toBe(AuditAction.FILE_DELETE);
    expect(event.resourceId).toBe(files[0].uuid);
    expect(event.metadata).toMatchObject({
      event: 'permanent_delete',
      fileName: files[0].originalName,
      storagePath: files[0].storagePath,
      retentionDays: 30,
    });
  });

  it('should attribute the purge to the system user by default', async () => {
    withExpiredFiles(1);

    await processor.cleanupExpiredFiles({ dryRun: false });

    const [event] = auditService.log.mock.calls[0] as [{ userId: string }];
    expect(event.userId).toBe(APP_CONSTANTS.SYSTEM_USER_ID);
  });

  it('should attribute the purge to the given actor', async () => {
    withExpiredFiles(1);

    await processor.cleanupExpiredFiles({
      dryRun: false,
      performedBy: 'admin-user-id',
    });

    const [event] = auditService.log.mock.calls[0] as [{ userId: string }];
    expect(event.userId).toBe('admin-user-id');
  });

  // ─── Bounded blast radius ────────────────────────────

  it('should cap the query at the default limit', async () => {
    await processor.cleanupExpiredFiles({ dryRun: true });

    expect(findChain.limit).toHaveBeenCalledWith(100);
  });

  it('should honour an explicit limit', async () => {
    await processor.cleanupExpiredFiles({ dryRun: true, limit: 5 });

    expect(findChain.limit).toHaveBeenCalledWith(5);
  });

  it('should only select files soft-deleted past the retention window', async () => {
    await processor.cleanupExpiredFiles({ dryRun: true });

    const filter = fileModel.find.mock.calls[0][0] as {
      isDeleted: boolean;
      deletedAt: { $lte: Date };
    };
    expect(filter.isDeleted).toBe(true);

    const cutoff = filter.deletedAt.$lte.getTime();
    const expected = Date.now() - 30 * 86400000;
    expect(Math.abs(cutoff - expected)).toBeLessThan(5000);
  });

  // ─── Failure handling ────────────────────────────────

  it('should count per-file failures and keep going', async () => {
    withExpiredFiles(3);
    fileModel.deleteOne
      .mockResolvedValueOnce({ deletedCount: 1 })
      .mockRejectedValueOnce(new Error('mongo down'))
      .mockResolvedValueOnce({ deletedCount: 1 });

    const result = await processor.cleanupExpiredFiles({ dryRun: false });

    expect(result.deleted).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.scanned).toBe(3);
  });

  it('should skip the storage delete when the blob is already gone', async () => {
    withExpiredFiles(1);
    storageService.exists.mockResolvedValue(false);

    const result = await processor.cleanupExpiredFiles({ dryRun: false });

    expect(storageService.delete).not.toHaveBeenCalled();
    // The metadata row is still removed.
    expect(fileModel.deleteOne).toHaveBeenCalledTimes(1);
    expect(result.deleted).toBe(1);
  });

  it('should report zeroes when the query itself fails', async () => {
    findChain.exec.mockRejectedValue(new Error('mongo down'));

    const result = await processor.cleanupExpiredFiles({ dryRun: false });

    expect(result).toMatchObject({ scanned: 0, deleted: 0, errors: 0 });
  });
});
