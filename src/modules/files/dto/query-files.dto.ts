import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * DTO for querying files with filters and pagination.
 */
export class QueryFilesDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search by filename' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by MIME type',
    example: 'application/pdf',
  })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({
    description: 'Filter by access level',
    enum: ['private', 'internal', 'department', 'public'],
  })
  @IsOptional()
  @IsEnum(['private', 'internal', 'department', 'public'])
  accessLevel?: string;

  @ApiPropertyOptional({ description: 'Filter by department' })
  @IsOptional()
  @IsString()
  department?: string;
}
