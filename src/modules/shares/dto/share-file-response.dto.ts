import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SharePermission } from '../enums/share-permission.enum';
import { ShareStatus } from '../enums/share-status.enum';

/**
 * Response after successfully creating a file share.
 */
export class ShareFileResponse {
  @ApiProperty({ example: '665b9876abcd5678ef901234' })
  shareId: string;

  @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  fileId: string;

  @ApiProperty({ example: '665a1234abcd5678ef901234' })
  ownerId: string;

  @ApiProperty({ example: '665a5678abcd1234ef905678' })
  sharedWithUserId: string;

  @ApiProperty({ enum: SharePermission, example: SharePermission.VIEW })
  permission: SharePermission;

  @ApiProperty({ enum: ShareStatus, example: ShareStatus.ACTIVE })
  status: ShareStatus;

  @ApiProperty({ example: '2026-05-31T12:00:00.000Z' })
  sharedAt: string;

  @ApiProperty({ example: '2026-06-05T10:00:00.000Z' })
  expiresAt: string;

  @ApiPropertyOptional({ example: 5, nullable: true })
  maxDownloads: number | null;

  @ApiPropertyOptional({ example: false })
  oneTimeAccess: boolean;

  @ApiPropertyOptional({ example: false })
  watermarkEnabled: boolean;

  @ApiProperty({ example: '2026-05-31T12:00:00.000Z' })
  createdAt: string;
}
