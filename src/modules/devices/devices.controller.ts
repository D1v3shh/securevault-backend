import {
  Controller, Post, Get, Patch, Body, Param, Query, Req,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth,
  ApiResponse as SwaggerResponse, ApiParam, ApiQuery,
} from '@nestjs/swagger';
import * as express from 'express';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto, UpdateDeviceStatusDto } from './dto/device.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import * as JwtPayloadNs from '../auth/interfaces/jwt-payload.interface';
import { Role } from '../permissions/constants/roles.enum';
import { DeviceStatus } from './schemas/device.schema';

/**
 * Device trust management controller.
 * Manages device registration, approval, and status tracking.
 */
@ApiTags('Devices')
@ApiBearerAuth('access-token')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  /**
   * POST /devices/register
   * Register a new device (used during enrollment or manual registration).
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new device',
    description: 'Registers a device with its fingerprint and hardware metadata. ' +
      'Checks for duplicate fingerprints and blocked devices.',
  })
  @SwaggerResponse({ status: 201, description: 'Device registered' })
  @SwaggerResponse({ status: 409, description: 'Duplicate fingerprint' })
  async register(
    @Body() dto: RegisterDeviceDto,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
  ) {
    const device = await this.devicesService.registerDevice(dto, user.userId);
    return {
      message: 'Device registered successfully',
      device: {
        deviceId: device.deviceId,
        fingerprint: device.fingerprint,
        employeeId: device.employeeId,
        status: device.status,
        hostname: device.hostname,
        platform: device.platform,
      },
    };
  }

  /**
   * GET /devices/me
   * Get all devices for the current authenticated user.
   */
  @Get('me')
  @ApiOperation({
    summary: 'Get my devices',
    description: 'Returns all devices registered to the current authenticated user.',
  })
  @SwaggerResponse({ status: 200, description: 'User devices list' })
  async getMyDevices(@CurrentUser() user: JwtPayloadNs.AuthenticatedUser) {
    const devices = await this.devicesService.findByUserId(user.userId);
    return {
      devices: devices.map(d => ({
        deviceId: d.deviceId,
        fingerprint: d.fingerprint,
        employeeId: d.employeeId,
        status: d.status,
        hostname: d.hostname,
        platform: d.platform,
        arch: d.arch,
        osVersion: d.osVersion,
        certificateSerial: d.certificateSerial,
        lastSeenAt: d.lastSeenAt,
        approvedAt: d.approvedAt,
        createdAt: (d as any).createdAt,
      })),
    };
  }

  /**
   * GET /devices/:id
   * Get device details by ID (admin or device owner).
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get device details',
    description: 'Returns detailed information about a specific device.',
  })
  @ApiParam({ name: 'id', description: 'Device MongoDB _id or deviceId' })
  @SwaggerResponse({ status: 200, description: 'Device details' })
  @SwaggerResponse({ status: 404, description: 'Device not found' })
  async getDevice(@Param('id') id: string) {
    // Try by deviceId first, then by MongoDB _id
    let device = await this.devicesService.findByDeviceId(id);
    if (!device) {
      device = await this.devicesService.findById(id);
    }

    if (!device) {
      return { found: false };
    }

    return {
      found: true,
      device: {
        deviceId: device.deviceId,
        fingerprint: device.fingerprint,
        employeeId: device.employeeId,
        status: device.status,
        hostname: device.hostname,
        platform: device.platform,
        arch: device.arch,
        osVersion: device.osVersion,
        macAddress: device.macAddress,
        serialNumber: device.serialNumber,
        certificateSerial: device.certificateSerial,
        lastSeenAt: device.lastSeenAt,
        lastSeenIp: device.lastSeenIp,
        approvedAt: device.approvedAt,
        approvedBy: device.approvedBy,
        revokedAt: device.revokedAt,
        revokedBy: device.revokedBy,
        revokeReason: device.revokeReason,
        createdAt: (device as any).createdAt,
      },
    };
  }

  /**
   * PATCH /devices/:id/status
   * Update device trust status (approve, revoke, block).
   */
  @Patch(':id/status')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: 'Update device status',
    description: 'Change device trust status. Admin/Super Admin only. ' +
      'Supported transitions: pending→approved, approved→revoked, any→blocked.',
  })
  @ApiParam({ name: 'id', description: 'Device MongoDB _id' })
  @SwaggerResponse({ status: 200, description: 'Device status updated' })
  @SwaggerResponse({ status: 404, description: 'Device not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeviceStatusDto,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
  ) {
    const device = await this.devicesService.updateStatus(id, dto, user.userId);
    return {
      message: `Device status updated to ${dto.status}`,
      device: {
        deviceId: device.deviceId,
        status: device.status,
        fingerprint: device.fingerprint,
        employeeId: device.employeeId,
      },
    };
  }
}
