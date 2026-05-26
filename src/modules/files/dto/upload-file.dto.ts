import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for file upload metadata.
 * File binary data comes via multipart form — this DTO handles the metadata fields.
 */
export class UploadFileDto {
  @ApiPropertyOptional({ description: 'File description', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Access level for the file',
    enum: ['private', 'internal', 'department', 'public'],
    default: 'private',
  })
  @IsOptional()
  @IsEnum(['private', 'internal', 'department', 'public'])
  accessLevel?: string;

  @ApiPropertyOptional({ description: 'Department the file belongs to' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;
}
