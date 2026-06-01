import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AuditService } from '../audit.service';
import { AuditLogEntity } from '../schemas/audit-log.schema';
import { AuditAction } from '../interfaces/audit.interface';

describe('AuditService', () => {
  let service: AuditService;
  let auditLogModel: any;

  beforeEach(async () => {
    auditLogModel = {
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getModelToken(AuditLogEntity.name), useValue: auditLogModel },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Log ────────────────────────────────────────────

  describe('log', () => {
    it('should create an audit log entry with all fields', async () => {
      auditLogModel.create.mockResolvedValue({});

      await service.log({
        action: AuditAction.LOGIN_SUCCESS,
        resource: 'auth',
        resourceId: 'user-123',
        userId: 'user-id',
        userEmail: 'user@test.com',
        userRole: 'ADMIN',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent',
        metadata: { extra: 'data' },
        status: 'success',
      });

      expect(auditLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LOGIN_SUCCESS,
          resource: 'auth',
          resourceId: 'user-123',
          userId: 'user-id',
          userEmail: 'user@test.com',
          ipAddress: '127.0.0.1',
          metadata: { extra: 'data' },
          status: 'success',
          timestamp: expect.any(Date),
        }),
      );
    });

    it('should handle null optional fields gracefully', async () => {
      auditLogModel.create.mockResolvedValue({});

      await service.log({
        action: AuditAction.FILE_UPLOAD,
        resource: 'file',
      });

      expect(auditLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: null,
          userId: null,
          userEmail: null,
          userRole: null,
          ipAddress: null,
          userAgent: null,
          metadata: {},
          status: 'success',
        }),
      );
    });

    it('should never throw even if create fails', async () => {
      auditLogModel.create.mockRejectedValue(new Error('DB connection lost'));

      // Should not throw — audit failures must be silent
      await expect(service.log({
        action: AuditAction.LOGIN_FAILURE,
        resource: 'auth',
      })).resolves.toBeUndefined();
    });
  });

  // ─── Find All (Paginated) ──────────────────────────

  describe('findAll', () => {
    it('should return paginated audit logs', async () => {
      const logs = [{ action: 'auth.login.success' }];
      const execFn = jest.fn().mockResolvedValue(logs);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      auditLogModel.find.mockReturnValue({ sort: sortFn });
      auditLogModel.countDocuments.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toEqual(logs);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it('should apply action filter (regex)', async () => {
      const execFn = jest.fn().mockResolvedValue([]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      auditLogModel.find.mockReturnValue({ sort: sortFn });
      auditLogModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ action: 'login' });

      const filter = auditLogModel.find.mock.calls[0][0];
      expect(filter.action.$regex).toBe('login');
      expect(filter.action.$options).toBe('i');
    });

    it('should apply userId and resource filters', async () => {
      const execFn = jest.fn().mockResolvedValue([]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      auditLogModel.find.mockReturnValue({ sort: sortFn });
      auditLogModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ userId: 'user-123', resource: 'file' });

      const filter = auditLogModel.find.mock.calls[0][0];
      expect(filter.userId).toBe('user-123');
      expect(filter.resource).toBe('file');
    });

    it('should apply date range filters', async () => {
      const start = new Date('2026-01-01');
      const end = new Date('2026-12-31');
      const execFn = jest.fn().mockResolvedValue([]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      auditLogModel.find.mockReturnValue({ sort: sortFn });
      auditLogModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ startDate: start, endDate: end });

      const filter = auditLogModel.find.mock.calls[0][0];
      expect(filter.timestamp.$gte).toEqual(start);
      expect(filter.timestamp.$lte).toEqual(end);
    });

    it('should handle startDate-only filter', async () => {
      const start = new Date('2026-06-01');
      const execFn = jest.fn().mockResolvedValue([]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      auditLogModel.find.mockReturnValue({ sort: sortFn });
      auditLogModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ startDate: start });

      const filter = auditLogModel.find.mock.calls[0][0];
      expect(filter.timestamp.$gte).toEqual(start);
      expect(filter.timestamp.$lte).toBeUndefined();
    });
  });
});
