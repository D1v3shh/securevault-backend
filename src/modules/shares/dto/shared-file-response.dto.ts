import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SharePermission } from '../enums/share-permission.enum';
import { ShareStatus } from '../enums/share-status.enum';

/**
 * Represents a file share record in list responses.
 * Includes denormalized file and user info for efficient rendering.
 */
export class SharedFileResponse {
  @ApiProperty({ example: '665b9876abcd5678ef901234' })
  shareId: string;

  @ApiProperty({
    description: 'Basic file metadata',
    example: {
      fileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      originalName: 'report-q4.pdf',
      mimeType: 'application/pdf',
      size: 1048576,
    },
  })
  file: {
    fileId: string;
    originalName: string;
    mimeType: string;
    size: number;
  };

  @ApiProperty({
    description: 'Owner user info',
    example: {
      userId: '665a1234abcd5678ef901234',
      email: 'owner@company.com',
      firstName: 'Jane',
      lastName: 'Doe',
    },
  })
  owner: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
  };

  @ApiProperty({
    description: 'Shared-with user info',
    example: {
      userId: '665a5678abcd1234ef905678',
      email: 'john@company.com',
      firstName: 'John',
      lastName: 'Smith',
    },
  })
  sharedWith: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
  };

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

  @ApiPropertyOptional({ example: 0 })
  downloadCount: number;

  @ApiPropertyOptional({ example: false })
  oneTimeAccess: boolean;

  @ApiPropertyOptional({ example: false })
  watermarkEnabled: boolean;

  @ApiProperty({ example: '2026-05-31T12:00:00.000Z' })
  createdAt: string;
}
