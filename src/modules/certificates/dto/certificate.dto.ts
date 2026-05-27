import {
  IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for certificate-based passwordless login.
 * The Main SecureVault App sends the installed certificate for verification.
 */
export class CertificateLoginDto {
  @ApiProperty({
    example: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
    description: 'PEM-encoded X.509 client certificate',
  })
  @IsString()
  @IsNotEmpty()
  certificate: string;

  @ApiProperty({
    example: 'abc123def456hash...',
    description: 'SHA-256 device fingerprint for binding validation',
  })
  @IsString()
  @IsNotEmpty()
  deviceFingerprint: string;

  @ApiPropertyOptional({
    example: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
    description: 'Optional: Intermediate CA certificate for chain verification',
  })
  @IsOptional()
  @IsString()
  caCertificate?: string;
}

/**
 * DTO for certificate verification (standalone endpoint).
 */
export class VerifyCertificateDto {
  @ApiProperty({
    example: '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----',
    description: 'PEM-encoded certificate to verify',
  })
  @IsString()
  @IsNotEmpty()
  certificate: string;

  @ApiPropertyOptional({
    example: 'abc123def456hash...',
    description: 'Device fingerprint to validate against certificate',
  })
  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}

/**
 * DTO for certificate revocation.
 */
export class RevokeCertificateDto {
  @ApiProperty({
    example: '7A:8B:9C:D0:E1:F2...',
    description: 'Certificate serial number to revoke',
  })
  @IsString()
  @IsNotEmpty()
  serialNumber: string;

  @ApiPropertyOptional({
    example: 'key_compromise',
    description: 'Reason for revocation per RFC 5280',
    enum: [
      'unspecified', 'key_compromise', 'ca_compromise',
      'affiliation_changed', 'superseded', 'cessation_of_operation',
      'privilege_withdrawn',
    ],
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
