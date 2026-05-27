import {
  IsString, IsNotEmpty, IsOptional, IsInt, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating an enrollment token (admin operation).
 */
export class CreateEnrollmentTokenDto {
  @ApiProperty({
    example: '683422e2a3b0c8c7f6d12345',
    description: 'MongoDB _id of the user to create the token for',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    example: 'EMP-001',
    description: 'Employee ID to bind the token to',
  })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiPropertyOptional({
    example: 24,
    description: 'Token validity in hours (default: 24)',
    minimum: 1,
    maximum: 720,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Maximum number of devices this token can enroll (default: 1)',
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxDevices?: number;
}
