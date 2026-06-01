import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DevicesService } from '../devices.service';
import { DeviceEntity, DeviceStatus } from '../schemas/device.schema';

describe('DevicesService', () => {
  let service: DevicesService;
  let deviceModel: any;

  const mockDevice = {
    _id: 'device-mongo-id',
    deviceId: 'dev-uuid-123',
    userId: new Types.ObjectId(),
    employeeId: 'EMP001',
    fingerprint: 'fp-abc123',
    hostname: 'WORKSTATION-01',
    platform: 'win32',
    status: DeviceStatus.PENDING,
    approvedAt: null,
    approvedBy: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    save: jest.fn(),
  };

  beforeEach(async () => {
    deviceModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: getModelToken(DeviceEntity.name), useValue: deviceModel },
      ],
    }).compile();

    service = module.get<DevicesService>(DevicesService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Register Device ────────────────────────────────

  describe('registerDevice', () => {
    const dto = {
      fingerprint: 'fp-new',
      employeeId: 'EMP002',
      hostname: 'WORKSTATION-02',
      platform: 'win32',
    };

    it('should register a new device successfully', async () => {
      deviceModel.findOne.mockResolvedValue(null);
      deviceModel.create.mockResolvedValue(mockDevice);

      const result = await service.registerDevice(dto, '507f1f77bcf86cd799439011');

      expect(deviceModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fingerprint: 'fp-new',
          employeeId: 'EMP002',
          status: DeviceStatus.PENDING,
          enrolledBy: '507f1f77bcf86cd799439011',
        }),
      );
      expect(result).toEqual(mockDevice);
    });

    it('should throw ConflictException for revoked device fingerprint', async () => {
      deviceModel.findOne.mockResolvedValue({ status: DeviceStatus.REVOKED });

      await expect(service.registerDevice(dto, '507f1f77bcf86cd799439011'))
        .rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException for blocked device fingerprint', async () => {
      deviceModel.findOne.mockResolvedValue({ status: DeviceStatus.BLOCKED });

      await expect(service.registerDevice(dto, '507f1f77bcf86cd799439011'))
        .rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException for already approved device', async () => {
      deviceModel.findOne.mockResolvedValue({ status: DeviceStatus.APPROVED });

      await expect(service.registerDevice(dto, '507f1f77bcf86cd799439011'))
        .rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException for pending device', async () => {
      deviceModel.findOne.mockResolvedValue({ status: DeviceStatus.PENDING });

      await expect(service.registerDevice(dto, '507f1f77bcf86cd799439011'))
        .rejects.toThrow(ConflictException);
    });
  });

  // ─── Find Methods ──────────────────────────────────

  describe('findByDeviceId', () => {
    it('should find device by deviceId', async () => {
      deviceModel.findOne.mockResolvedValue(mockDevice);

      const result = await service.findByDeviceId('dev-uuid-123');

      expect(deviceModel.findOne).toHaveBeenCalledWith({ deviceId: 'dev-uuid-123' });
      expect(result).toEqual(mockDevice);
    });
  });

  describe('findByFingerprint', () => {
    it('should find device by fingerprint', async () => {
      deviceModel.findOne.mockResolvedValue(mockDevice);

      const result = await service.findByFingerprint('fp-abc123');

      expect(deviceModel.findOne).toHaveBeenCalledWith({ fingerprint: 'fp-abc123' });
      expect(result).toEqual(mockDevice);
    });
  });

  describe('findByUserId', () => {
    it('should find all devices for a user', async () => {
      const execFn = jest.fn().mockResolvedValue([mockDevice]);
      const sortFn = jest.fn().mockReturnValue({ exec: execFn });
      deviceModel.find.mockReturnValue({ sort: sortFn });

      const result = await service.findByUserId('507f1f77bcf86cd799439011');

      expect(result).toEqual([mockDevice]);
    });
  });

  describe('findByEmployeeId', () => {
    it('should find all devices for an employee', async () => {
      const execFn = jest.fn().mockResolvedValue([mockDevice]);
      const sortFn = jest.fn().mockReturnValue({ exec: execFn });
      deviceModel.find.mockReturnValue({ sort: sortFn });

      const result = await service.findByEmployeeId('EMP001');

      expect(result).toEqual([mockDevice]);
    });
  });

  // ─── Approve Device ─────────────────────────────────

  describe('approveDevice', () => {
    it('should approve a pending device', async () => {
      const pendingDevice = { ...mockDevice, status: DeviceStatus.PENDING, save: jest.fn() };
      deviceModel.findOne.mockResolvedValue(pendingDevice);

      const result = await service.approveDevice('dev-uuid-123', 'admin-id');

      expect(pendingDevice.status).toBe(DeviceStatus.APPROVED);
      expect(pendingDevice.approvedBy).toBe('admin-id');
      expect(pendingDevice.approvedAt).toBeInstanceOf(Date);
      expect(pendingDevice.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent device', async () => {
      deviceModel.findOne.mockResolvedValue(null);

      await expect(service.approveDevice('bad-id', 'admin-id'))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-pending device', async () => {
      deviceModel.findOne.mockResolvedValue({ ...mockDevice, status: DeviceStatus.APPROVED });

      await expect(service.approveDevice('dev-uuid-123', 'admin-id'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ─── Update Status ──────────────────────────────────

  describe('updateStatus', () => {
    it('should approve a device via status update', async () => {
      const device = { ...mockDevice, save: jest.fn() };
      deviceModel.findById.mockResolvedValue(device);

      await service.updateStatus('device-mongo-id', { status: DeviceStatus.APPROVED }, 'admin-id');

      expect(device.status).toBe(DeviceStatus.APPROVED);
      expect(device.approvedBy).toBe('admin-id');
      expect(device.save).toHaveBeenCalled();
    });

    it('should revoke a device with reason', async () => {
      const device = { ...mockDevice, save: jest.fn() };
      deviceModel.findById.mockResolvedValue(device);

      await service.updateStatus(
        'device-mongo-id',
        { status: DeviceStatus.REVOKED, reason: 'Lost device' },
        'admin-id',
      );

      expect(device.status).toBe(DeviceStatus.REVOKED);
      expect(device.revokedBy).toBe('admin-id');
      expect(device.revokeReason).toBe('Lost device');
      expect(device.revokedAt).toBeInstanceOf(Date);
    });

    it('should block a device with default reason', async () => {
      const device = { ...mockDevice, save: jest.fn() };
      deviceModel.findById.mockResolvedValue(device);

      await service.updateStatus(
        'device-mongo-id',
        { status: DeviceStatus.BLOCKED },
        'admin-id',
      );

      expect(device.status).toBe(DeviceStatus.BLOCKED);
      expect(device.revokeReason).toBe('Blocked by administrator');
    });

    it('should throw NotFoundException for non-existent device', async () => {
      deviceModel.findById.mockResolvedValue(null);

      await expect(
        service.updateStatus('bad-id', { status: DeviceStatus.APPROVED }, 'admin-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Bind Certificate ────────────────────────────────

  describe('bindCertificate', () => {
    it('should bind certificate serial to device', async () => {
      deviceModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.bindCertificate('dev-uuid-123', 'SERIAL-001');

      expect(deviceModel.updateOne).toHaveBeenCalledWith(
        { deviceId: 'dev-uuid-123' },
        { certificateSerial: 'SERIAL-001' },
      );
    });
  });

  // ─── Update Last Seen ────────────────────────────────

  describe('updateLastSeen', () => {
    it('should update last seen timestamp and IP', async () => {
      deviceModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.updateLastSeen('dev-uuid-123', '192.168.1.1');

      expect(deviceModel.updateOne).toHaveBeenCalledWith(
        { deviceId: 'dev-uuid-123' },
        { lastSeenAt: expect.any(Date), lastSeenIp: '192.168.1.1' },
      );
    });
  });

  // ─── Is Device Trusted ──────────────────────────────

  describe('isDeviceTrusted', () => {
    it('should return true for approved device', async () => {
      deviceModel.findOne.mockResolvedValue(mockDevice);

      const result = await service.isDeviceTrusted('fp-abc123');

      expect(result).toBe(true);
      expect(deviceModel.findOne).toHaveBeenCalledWith({
        fingerprint: 'fp-abc123',
        status: DeviceStatus.APPROVED,
      });
    });

    it('should return false when no approved device found', async () => {
      deviceModel.findOne.mockResolvedValue(null);

      const result = await service.isDeviceTrusted('fp-unknown');

      expect(result).toBe(false);
    });
  });

  // ─── Find All (Paginated) ──────────────────────────

  describe('findAll', () => {
    it('should return paginated devices', async () => {
      const execFn = jest.fn().mockResolvedValue([mockDevice]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      deviceModel.find.mockReturnValue({ sort: sortFn });
      deviceModel.countDocuments.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toEqual([mockDevice]);
      expect(result.meta.total).toBe(1);
    });

    it('should apply status and employeeId filters', async () => {
      const execFn = jest.fn().mockResolvedValue([]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      deviceModel.find.mockReturnValue({ sort: sortFn });
      deviceModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ status: DeviceStatus.APPROVED, employeeId: 'EMP001' });

      const filterArg = deviceModel.find.mock.calls[0][0];
      expect(filterArg.status).toBe(DeviceStatus.APPROVED);
      expect(filterArg.employeeId).toBe('EMP001');
    });

    it('should apply search filter', async () => {
      const execFn = jest.fn().mockResolvedValue([]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      deviceModel.find.mockReturnValue({ sort: sortFn });
      deviceModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ search: 'WORKSTATION' });

      const filterArg = deviceModel.find.mock.calls[0][0];
      expect(filterArg.$or).toBeDefined();
      expect(filterArg.$or).toHaveLength(4);
    });
  });
});
