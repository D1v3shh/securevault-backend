import {
  IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceStatus } from '../schemas/device.schema';

/**
 * DTO for registering a new device.
 */
export class RegisterDeviceDto {
  @ApiProperty({
    example: 'abc123def456hash...',
    description: 'SHA-256 device fingerprint from hardware identifiers',
  })
  @IsString()
  @IsNotEmpty()
  fingerprint: string;

  @ApiProperty({
    example: 'EMP-001',
    description: 'Employee ID that owns this device',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  employeeId: string;

  @ApiPropertyOptional({ example: 'WORKSTATION-001' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  hostname?: string;

  @ApiPropertyOptional({ example: 'win32' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  platform?: string;

  @ApiPropertyOptional({ example: 'x64' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  arch?: string;

  @ApiPropertyOptional({ example: 'Windows 11 Pro 23H2' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  osVersion?: string;

  @ApiPropertyOptional({ example: '00:1A:2B:3C:4D:5E' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  macAddress?: string;

  @ApiPropertyOptional({ example: 'SN-1234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;
}

/**
 * DTO for updating device status.
 */
export class UpdateDeviceStatusDto {
  @ApiProperty({
    enum: DeviceStatus,
    example: DeviceStatus.APPROVED,
    description: 'New device status',
  })
  @IsEnum(DeviceStatus)
  @IsNotEmpty()
  status: DeviceStatus;

  @ApiPropertyOptional({
    example: 'Device verified by IT department',
    description: 'Reason for status change',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
