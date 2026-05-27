import {
  Injectable, Logger, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DeviceEntity, DeviceDocument, DeviceStatus } from './schemas/device.schema';
import { RegisterDeviceDto, UpdateDeviceStatusDto } from './dto/device.dto';
import { PaginationDto, PaginatedResponse } from '../../common/dto/pagination.dto';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectModel(DeviceEntity.name)
    private readonly deviceModel: Model<DeviceDocument>,
  ) {}

  /**
   * Register a new device during enrollment.
   * Checks for duplicate fingerprints.
   */
  async registerDevice(
    dto: RegisterDeviceDto,
    userId: string,
  ): Promise<DeviceDocument> {
    // Check for duplicate fingerprint
    const existing = await this.deviceModel.findOne({
      fingerprint: dto.fingerprint,
    });

    if (existing) {
      if (existing.status === DeviceStatus.REVOKED || existing.status === DeviceStatus.BLOCKED) {
        throw new ConflictException(
          'This device fingerprint has been revoked or blocked. Contact your administrator.',
        );
      }
      if (existing.status === DeviceStatus.APPROVED || existing.status === DeviceStatus.PENDING) {
        throw new ConflictException(
          'A device with this fingerprint is already registered.',
        );
      }
    }

    const device = await this.deviceModel.create({
      userId: new Types.ObjectId(userId),
      employeeId: dto.employeeId,
      fingerprint: dto.fingerprint,
      hostname: dto.hostname || null,
      platform: dto.platform || null,
      arch: dto.arch || null,
      osVersion: dto.osVersion || null,
      macAddress: dto.macAddress || null,
      serialNumber: dto.serialNumber || null,
      status: DeviceStatus.PENDING,
      enrolledBy: userId,
    });

    this.logger.log(`Device registered: ${device.deviceId} for employee ${dto.employeeId}`);
    return device;
  }

  /**
   * Find device by its UUID.
   */
  async findByDeviceId(deviceId: string): Promise<DeviceDocument | null> {
    return this.deviceModel.findOne({ deviceId });
  }

  /**
   * Find device by MongoDB _id.
   */
  async findById(id: string): Promise<DeviceDocument | null> {
    return this.deviceModel.findById(id);
  }

  /**
   * Find device by fingerprint.
   */
  async findByFingerprint(fingerprint: string): Promise<DeviceDocument | null> {
    return this.deviceModel.findOne({ fingerprint });
  }

  /**
   * Find all devices for a specific user.
   */
  async findByUserId(userId: string): Promise<DeviceDocument[]> {
    return this.deviceModel.find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Find all devices for a specific employee.
   */
  async findByEmployeeId(employeeId: string): Promise<DeviceDocument[]> {
    return this.deviceModel.find({ employeeId })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Approve a device (transitions from pending to approved).
   */
  async approveDevice(deviceId: string, approvedBy: string): Promise<DeviceDocument> {
    const device = await this.deviceModel.findOne({ deviceId });
    if (!device) throw new NotFoundException('Device not found');

    if (device.status !== DeviceStatus.PENDING) {
      throw new BadRequestException(`Cannot approve device in '${device.status}' status`);
    }

    device.status = DeviceStatus.APPROVED;
    device.approvedAt = new Date();
    device.approvedBy = approvedBy;
    await device.save();

    this.logger.log(`Device approved: ${deviceId} by ${approvedBy}`);
    return device;
  }

  /**
   * Update device status (approve, revoke, block).
   */
  async updateStatus(
    id: string,
    dto: UpdateDeviceStatusDto,
    updatedBy: string,
  ): Promise<DeviceDocument> {
    const device = await this.deviceModel.findById(id);
    if (!device) throw new NotFoundException('Device not found');

    const previousStatus = device.status;
    device.status = dto.status;

    if (dto.status === DeviceStatus.APPROVED) {
      device.approvedAt = new Date();
      device.approvedBy = updatedBy;
    } else if (dto.status === DeviceStatus.REVOKED) {
      device.revokedAt = new Date();
      device.revokedBy = updatedBy;
      device.revokeReason = dto.reason || null;
    } else if (dto.status === DeviceStatus.BLOCKED) {
      device.revokedAt = new Date();
      device.revokedBy = updatedBy;
      device.revokeReason = dto.reason || 'Blocked by administrator';
    }

    await device.save();

    this.logger.log(
      `Device status changed: ${device.deviceId} ${previousStatus} → ${dto.status} by ${updatedBy}`,
    );
    return device;
  }

  /**
   * Bind a certificate serial to a device.
   */
  async bindCertificate(deviceId: string, certificateSerial: string): Promise<void> {
    await this.deviceModel.updateOne(
      { deviceId },
      { certificateSerial },
    );
  }

  /**
   * Update device last-seen timestamp.
   */
  async updateLastSeen(deviceId: string, ip: string): Promise<void> {
    await this.deviceModel.updateOne(
      { deviceId },
      { lastSeenAt: new Date(), lastSeenIp: ip },
    );
  }

  /**
   * Check if a device is trusted (approved and not revoked/blocked).
   */
  async isDeviceTrusted(fingerprint: string): Promise<boolean> {
    const device = await this.deviceModel.findOne({
      fingerprint,
      status: DeviceStatus.APPROVED,
    });
    return !!device;
  }

  /**
   * List all devices with pagination (admin).
   */
  async findAll(
    query: PaginationDto & {
      status?: DeviceStatus;
      employeeId?: string;
      search?: string;
    },
  ): Promise<PaginatedResponse<DeviceDocument>> {
    const { page = 1, limit = 20, status, employeeId, search } = query;
    const filter: Record<string, any> = {};

    if (status) filter.status = status;
    if (employeeId) filter.employeeId = employeeId;
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { hostname: { $regex: escapedSearch, $options: 'i' } },
        { employeeId: { $regex: escapedSearch, $options: 'i' } },
        { deviceId: { $regex: escapedSearch, $options: 'i' } },
        { fingerprint: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.deviceModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.deviceModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }
}
