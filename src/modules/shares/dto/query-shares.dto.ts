import { IsOptional, IsEnum, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ShareStatus } from '../enums/share-status.enum';

/**
 * Supported sort fields for share listing endpoints.
 */
export enum ShareSortField {
  CREATED_AT = 'createdAt',
  EXPIRES_AT = 'expiresAt',
  FILE_NAME = 'fileName',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * Query parameters for listing shared files.
 */
export class QuerySharesDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by share status (default: ACTIVE only)',
    enum: ShareStatus,
    example: ShareStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(ShareStatus)
  status?: ShareStatus;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ShareSortField,
    default: ShareSortField.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(ShareSortField)
  sortBy?: ShareSortField = ShareSortField.CREATED_AT;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: SortOrder,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({
    description: 'Search by file name',
    example: 'report',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
