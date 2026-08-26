import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ShareService } from '../services/share.service';
import { FileAccessEntity } from '../schemas/file-access.schema';
import { FileEntity } from '../../files/schemas/file.schema';
import { UserEntity } from '../../users/schemas/user.schema';
import { AuditService } from '../../audit/audit.service';
import { SharePermission } from '../enums/share-permission.enum';
import { ShareStatus } from '../enums/share-status.enum';
import { ShareSortField, SortOrder } from '../dto/query-shares.dto';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { Role } from '../../permissions/constants/roles.enum';

const ownerId = new Types.ObjectId();
const recipientId = new Types.ObjectId();

const recipient: AuthenticatedUser = {
  userId: recipientId.toString(),
  uuid: 'recipient-uuid',
  email: 'recipient@company.com',
  role: Role.EMPLOYEE,
};

/**
 * A row shaped the way the aggregation returns it: refs already replaced by the
 * joined sub-documents, exactly what ShareMapper consumes.
 */
const buildAggregatedRow = (index: number) => ({
  _id: new Types.ObjectId(),
  fileId: {
    _id: new Types.ObjectId(),
    uuid: `file-uuid-${index}`,
    originalName: `report-${index}.pdf`,
    mimeType: 'application/pdf',
    size: 1024 + index,
  },
  ownerId: {
    _id: ownerId,
    email: 'owner@company.com',
    firstName: 'Jane',
    lastName: 'Doe',
  },
  sharedWithUserId: {
    _id: recipientId,
    email: 'recipient@company.com',
    firstName: 'John',
    lastName: 'Smith',
  },
  permission: SharePermission.VIEW,
  status: ShareStatus.ACTIVE,
  sharedAt: new Date(),
  expiresAt: new Date(Date.now() + 86400000),
  maxDownloads: null,
  downloadCount: 0,
  oneTimeAccess: false,
  watermarkEnabled: false,
  createdAt: new Date(),
});

const createMockModel = () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
  updateMany: jest.fn(),
});

describe('ShareService.listShares — file name search', () => {
  let service: ShareService;
  let fileAccessModel: ReturnType<typeof createMockModel>;

  /** Make aggregate() answer with a $facet-shaped result of `rows` rows. */
  const mockFacetResult = (rows: number) => {
    const data = Array.from({ length: rows }, (_, i) => buildAggregatedRow(i));
    fileAccessModel.aggregate.mockResolvedValue([
      { data, meta: rows > 0 ? [{ total: rows }] : [] },
    ]);
  };

  beforeEach(async () => {
    fileAccessModel = createMockModel();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShareService,
        {
          provide: getModelToken(FileAccessEntity.name),
          useValue: fileAccessModel,
        },
        {
          provide: getModelToken(FileEntity.name),
          useValue: createMockModel(),
        },
        {
          provide: getModelToken(UserEntity.name),
          useValue: createMockModel(),
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get<ShareService>(ShareService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Query count is independent of result count ──────

  it.each([1, 3, 25, 100])(
    'should issue exactly one query for %i result rows',
    async (rows) => {
      mockFacetResult(rows);

      const result = await service.getSharedWithMe(
        { page: 1, limit: rows, search: 'report' },
        recipient,
      );

      expect(result.data).toHaveLength(rows);
      expect(result.meta.total).toBe(rows);

      // One aggregate, and no per-row re-fetch of any kind.
      expect(fileAccessModel.aggregate).toHaveBeenCalledTimes(1);
      expect(fileAccessModel.findById).not.toHaveBeenCalled();
      expect(fileAccessModel.findOne).not.toHaveBeenCalled();
      expect(fileAccessModel.find).not.toHaveBeenCalled();
      expect(fileAccessModel.countDocuments).not.toHaveBeenCalled();
    },
  );

  it('should keep the query count flat as the result set grows', async () => {
    const callCounts: number[] = [];

    for (const rows of [1, 10, 50, 200]) {
      jest.clearAllMocks();
      mockFacetResult(rows);

      await service.getSharedWithMe(
        { page: 1, limit: rows, search: 'report' },
        recipient,
      );

      callCounts.push(
        fileAccessModel.aggregate.mock.calls.length +
          fileAccessModel.findById.mock.calls.length +
          fileAccessModel.find.mock.calls.length +
          fileAccessModel.countDocuments.mock.calls.length,
      );
    }

    // Was 2 + N before the refactor; constant now.
    expect(callCounts).toEqual([1, 1, 1, 1]);
  });

  // ─── Pipeline shape ──────────────────────────────────

  it('should join file, owner and recipient inside the pipeline', async () => {
    mockFacetResult(2);

    await service.getSharedWithMe(
      { page: 1, limit: 20, search: 'report' },
      recipient,
    );

    const pipeline = fileAccessModel.aggregate.mock.calls[0][0] as any[];
    const json = JSON.stringify(pipeline);

    // The file join and name filter still happen before pagination.
    expect(pipeline[1].$lookup).toMatchObject({
      from: 'files',
      localField: 'fileId',
      foreignField: '_id',
    });

    // Data and count come back from a single $facet.
    const facet = pipeline.find((stage) => stage.$facet) as {
      $facet: { data: any[]; meta: any[] };
    };
    expect(facet).toBeDefined();
    expect(facet.$facet.meta).toEqual([{ $count: 'total' }]);

    // Both user refs are resolved by $lookup, not by a follow-up query.
    const userLookups = facet.$facet.data.filter(
      (stage) => stage.$lookup?.from === 'users',
    );
    expect(userLookups).toHaveLength(2);
    expect(userLookups.map((s) => s.$lookup.localField).sort()).toEqual([
      'ownerId',
      'sharedWithUserId',
    ]);
    expect(json).not.toContain('populate');
  });

  it('should apply the user joins after pagination so only page rows are joined', async () => {
    mockFacetResult(2);

    await service.getSharedWithMe(
      { page: 2, limit: 20, search: 'report' },
      recipient,
    );

    const pipeline = fileAccessModel.aggregate.mock.calls[0][0] as any[];
    const facet = pipeline.find((stage) => stage.$facet) as {
      $facet: { data: any[] };
    };
    const stageNames = facet.$facet.data.map((s) => Object.keys(s)[0]);

    expect(stageNames.indexOf('$limit')).toBeLessThan(
      stageNames.indexOf('$lookup'),
    );
    expect(facet.$facet.data).toContainEqual({ $skip: 20 });
    expect(facet.$facet.data).toContainEqual({ $limit: 20 });
  });

  it('should sort by file name inside the pipeline when requested', async () => {
    mockFacetResult(1);

    await service.getSharedWithMe(
      {
        page: 1,
        limit: 20,
        search: 'report',
        sortBy: ShareSortField.FILE_NAME,
        sortOrder: SortOrder.ASC,
      },
      recipient,
    );

    const pipeline = fileAccessModel.aggregate.mock.calls[0][0] as any[];
    const facet = pipeline.find((stage) => stage.$facet) as {
      $facet: { data: any[] };
    };

    expect(facet.$facet.data[0]).toEqual({
      $sort: { 'fileInfo.originalName': 1 },
    });
  });

  // ─── Response mapping and empty results ──────────────

  it('should map joined refs into the response DTO', async () => {
    mockFacetResult(1);

    const result = await service.getSharedWithMe(
      { page: 1, limit: 20, search: 'report' },
      recipient,
    );

    expect(result.data[0]).toMatchObject({
      file: {
        fileId: 'file-uuid-0',
        originalName: 'report-0.pdf',
        mimeType: 'application/pdf',
      },
      owner: { email: 'owner@company.com', firstName: 'Jane' },
      sharedWith: { email: 'recipient@company.com', firstName: 'John' },
    });
  });

  it('should handle an empty result set without extra queries', async () => {
    fileAccessModel.aggregate.mockResolvedValue([{ data: [], meta: [] }]);

    const result = await service.getSharedWithMe(
      { page: 1, limit: 20, search: 'nothing-matches' },
      recipient,
    );

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.totalPages).toBe(0);
    expect(fileAccessModel.aggregate).toHaveBeenCalledTimes(1);
    expect(fileAccessModel.findById).not.toHaveBeenCalled();
  });

  it('should tolerate an aggregate returning no facet document', async () => {
    fileAccessModel.aggregate.mockResolvedValue([]);

    const result = await service.getSharedWithMe(
      { page: 1, limit: 20, search: 'report' },
      recipient,
    );

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  // ─── Non-search path untouched ───────────────────────

  it('should still use find + countDocuments when no search term is given', async () => {
    const chain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    fileAccessModel.find.mockReturnValue(chain);
    fileAccessModel.countDocuments.mockResolvedValue(0);

    await service.getSharedWithMe({ page: 1, limit: 20 }, recipient);

    expect(fileAccessModel.find).toHaveBeenCalledTimes(1);
    expect(fileAccessModel.countDocuments).toHaveBeenCalledTimes(1);
    expect(fileAccessModel.aggregate).not.toHaveBeenCalled();
  });
});

describe('ShareService.listShares — file name sort without search', () => {
  let service: ShareService;
  let fileAccessModel: ReturnType<typeof createMockModel>;

  const mockFacetResult = (rows: number) => {
    const data = Array.from({ length: rows }, (_, i) => buildAggregatedRow(i));
    fileAccessModel.aggregate.mockResolvedValue([
      { data, meta: rows > 0 ? [{ total: rows }] : [] },
    ]);
  };

  /** Stub the find + populate chain used by the non-aggregation path. */
  const mockFindChain = () => {
    const chain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    fileAccessModel.find.mockReturnValue(chain);
    fileAccessModel.countDocuments.mockResolvedValue(0);
    return chain;
  };

  beforeEach(async () => {
    fileAccessModel = createMockModel();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShareService,
        {
          provide: getModelToken(FileAccessEntity.name),
          useValue: fileAccessModel,
        },
        {
          provide: getModelToken(FileEntity.name),
          useValue: createMockModel(),
        },
        {
          provide: getModelToken(UserEntity.name),
          useValue: createMockModel(),
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get<ShareService>(ShareService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const getSortStage = () => {
    const pipeline = fileAccessModel.aggregate.mock.calls[0][0] as any[];
    const facet = pipeline.find((stage) => stage.$facet) as {
      $facet: { data: any[] };
    };
    return facet.$facet.data[0];
  };

  it('should actually sort by file name instead of falling back to createdAt', async () => {
    mockFacetResult(3);

    const result = await service.getSharedWithMe(
      { page: 1, limit: 20, sortBy: ShareSortField.FILE_NAME },
      recipient,
    );

    expect(result.data).toHaveLength(3);

    // Routed through the aggregation because originalName lives on the file.
    expect(fileAccessModel.aggregate).toHaveBeenCalledTimes(1);
    expect(fileAccessModel.find).not.toHaveBeenCalled();

    // The regression: this used to silently become { createdAt: -1 }.
    expect(getSortStage()).toEqual({
      $sort: { 'fileInfo.originalName': -1 },
    });
    expect(JSON.stringify(getSortStage())).not.toContain('createdAt');
  });

  it('should honour ascending order', async () => {
    mockFacetResult(1);

    await service.getSharedWithMe(
      {
        page: 1,
        limit: 20,
        sortBy: ShareSortField.FILE_NAME,
        sortOrder: SortOrder.ASC,
      },
      recipient,
    );

    expect(getSortStage()).toEqual({ $sort: { 'fileInfo.originalName': 1 } });
  });

  it('should not add a name filter when there is no search term', async () => {
    mockFacetResult(2);

    await service.getSharedWithMe(
      { page: 1, limit: 20, sortBy: ShareSortField.FILE_NAME },
      recipient,
    );

    const pipeline = fileAccessModel.aggregate.mock.calls[0][0] as any[];
    const json = JSON.stringify(pipeline);

    // Sorting must not narrow the result set.
    expect(json).not.toContain('$regex');
    expect(json).not.toContain('isDeleted');
  });

  it('should keep shares whose file document is missing', async () => {
    mockFacetResult(1);

    await service.getSharedWithMe(
      { page: 1, limit: 20, sortBy: ShareSortField.FILE_NAME },
      recipient,
    );

    const pipeline = fileAccessModel.aggregate.mock.calls[0][0] as any[];
    const fileUnwind = pipeline.find(
      (stage) => stage.$unwind?.path === '$fileInfo',
    );

    // Row set must match the other sort options, which list orphaned shares.
    expect(fileUnwind.$unwind.preserveNullAndEmptyArrays).toBe(true);
  });

  it('should sort case-insensitively via collation', async () => {
    mockFacetResult(1);

    await service.getSharedWithMe(
      { page: 1, limit: 20, sortBy: ShareSortField.FILE_NAME },
      recipient,
    );

    expect(fileAccessModel.aggregate.mock.calls[0][1]).toEqual({
      collation: { locale: 'en', strength: 2 },
    });
  });

  it('should stay a single query for a name sort as the page grows', async () => {
    for (const rows of [1, 20, 100]) {
      jest.clearAllMocks();
      mockFacetResult(rows);

      await service.getSharedWithMe(
        { page: 1, limit: rows, sortBy: ShareSortField.FILE_NAME },
        recipient,
      );

      expect(fileAccessModel.aggregate).toHaveBeenCalledTimes(1);
      expect(fileAccessModel.findById).not.toHaveBeenCalled();
      expect(fileAccessModel.countDocuments).not.toHaveBeenCalled();
    }
  });

  it('should combine a name sort with a name search in one query', async () => {
    mockFacetResult(2);

    await service.getSharedByMe(
      {
        page: 1,
        limit: 20,
        search: 'report',
        sortBy: ShareSortField.FILE_NAME,
        sortOrder: SortOrder.ASC,
      },
      recipient,
    );

    const pipeline = fileAccessModel.aggregate.mock.calls[0][0] as any[];
    const json = JSON.stringify(pipeline);

    expect(fileAccessModel.aggregate).toHaveBeenCalledTimes(1);
    expect(getSortStage()).toEqual({ $sort: { 'fileInfo.originalName': 1 } });
    expect(json).toContain('$regex');
  });

  // ─── Other sort fields keep the cheaper path ─────────

  it.each([ShareSortField.CREATED_AT, ShareSortField.EXPIRES_AT])(
    'should keep %s on the find + countDocuments path',
    async (sortBy) => {
      const chain = mockFindChain();

      await service.getSharedWithMe({ page: 1, limit: 20, sortBy }, recipient);

      expect(fileAccessModel.aggregate).not.toHaveBeenCalled();
      expect(fileAccessModel.find).toHaveBeenCalledTimes(1);
      expect(chain.sort).toHaveBeenCalledWith({ [sortBy]: -1 });
    },
  );

  it('should default to createdAt when no sort field is given', async () => {
    const chain = mockFindChain();

    await service.getSharedWithMe({ page: 1, limit: 20 }, recipient);

    expect(fileAccessModel.aggregate).not.toHaveBeenCalled();
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
  });
});
