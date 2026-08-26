import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DevicesService } from '../devices.service';
import { DeviceEntity, DeviceStatus } from '../schemas/device.schema';
import { SessionsService } from '../../sessions/sessions.service';

describe('DevicesService.updateStatus — session teardown', () => {
  let service: DevicesService;
  let deviceModel: { findById: jest.Mock };
  let sessionsService: { endDeviceSessions: jest.Mock };
  let device: Record<string, any>;

  beforeEach(async () => {
    device = {
      _id: new Types.ObjectId(),
      deviceId: 'dev_abc123',
      status: DeviceStatus.APPROVED,
      save: jest.fn().mockResolvedValue(undefined),
    };
    deviceModel = { findById: jest.fn().mockResolvedValue(device) };
    sessionsService = {
      endDeviceSessions: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevicesService,
        { provide: getModelToken(DeviceEntity.name), useValue: deviceModel },
        { provide: SessionsService, useValue: sessionsService },
      ],
    }).compile();

    service = module.get<DevicesService>(DevicesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each([DeviceStatus.REVOKED, DeviceStatus.BLOCKED])(
    'should end the device sessions when status becomes %s',
    async (status) => {
      await service.updateStatus(
        device._id.toString(),
        { status, reason: 'lost laptop' },
        'admin-user-id',
      );

      expect(sessionsService.endDeviceSessions).toHaveBeenCalledWith(
        'dev_abc123',
      );
    },
  );

  it('should not end sessions when a device is approved', async () => {
    device.status = DeviceStatus.PENDING;

    await service.updateStatus(
      device._id.toString(),
      { status: DeviceStatus.APPROVED },
      'admin-user-id',
    );

    expect(sessionsService.endDeviceSessions).not.toHaveBeenCalled();
  });

  it('should persist the device before ending its sessions', async () => {
    const order: string[] = [];
    device.save.mockImplementation(() => {
      order.push('save');
      return Promise.resolve();
    });
    sessionsService.endDeviceSessions.mockImplementation(() => {
      order.push('endDeviceSessions');
      return Promise.resolve();
    });

    await service.updateStatus(
      device._id.toString(),
      { status: DeviceStatus.REVOKED },
      'admin-user-id',
    );

    expect(order).toEqual(['save', 'endDeviceSessions']);
  });
});
