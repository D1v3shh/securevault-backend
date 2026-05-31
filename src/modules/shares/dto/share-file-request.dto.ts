import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsDateString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SharePermission } from '../enums/share-permission.enum';

/**
 * Request body for sharing a file with another user.
 */
export class ShareFileRequest {
  @ApiProperty({
    description: 'UUID or MongoDB ObjectId of the file to share',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @IsNotEmpty()
  @IsString()
  fileId: string;

  @ApiProperty({
    description: 'MongoDB ObjectId of the user to share with',
    example: '665a1234abcd5678ef901234',
  })
  @IsNotEmpty()
  @IsString()
  sharedWithUserId: string;

  @ApiProperty({
    description: 'Permission level to grant',
    enum: SharePermission,
    example: SharePermission.VIEW,
  })
  @IsNotEmpty()
  @IsEnum(SharePermission)
  permission: SharePermission;

  @ApiProperty({
    description: 'Expiration timestamp (ISO 8601). Must be in the future.',
    example: '2026-06-05T10:00:00Z',
  })
  @IsNotEmpty()
  @IsDateString()
  expiresAt: string;

  // ─── Optional Enterprise Controls ───────────────────
  @ApiPropertyOptional({
    description: 'Maximum number of downloads allowed (null = unlimited)',
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDownloads?: number;

  @ApiPropertyOptional({
    description: 'If true, the share is revoked after first access',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  oneTimeAccess?: boolean;

  @ApiPropertyOptional({
    description: 'If true, downloaded files will be watermarked',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  watermarkEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Device certificate ID to restrict access to a specific device',
    example: null,
  })
  @IsOptional()
  @IsString()
  allowedDeviceCertificateId?: string;
}
