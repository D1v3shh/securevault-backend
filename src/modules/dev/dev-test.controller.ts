import {
  Controller, Get, Post, Body, HttpCode, HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerResponse, ApiBody } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { DevTestService } from './dev-test.service';
import { AuthService } from '../auth/auth.service';

/**
 * DTO for quick certificate login — just pass an employee ID.
 */
class QuickCertLoginDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;
}

/**
 * ============================================================
 * ⚠️  DEVELOPMENT-ONLY CONTROLLER
 * ============================================================
 *
 * Provides shortcuts for testing certificate-based authentication
 * without needing to manually copy PEM strings.
 *
 * This controller is ONLY registered when NODE_ENV !== 'production'.
 */
@ApiTags('Dev Testing')
@Controller('dev')
export class DevTestController {
  constructor(
    private readonly devTestService: DevTestService,
    private readonly authService: AuthService,
  ) {}

  /**
   * GET /dev/status
   * Shows the current development environment status.
   */
  @Public()
  @Get('status')
  @ApiOperation({
    summary: '🔧 Dev environment status',
    description: 'Shows database counts, test certificate status, and environment info. ' +
      'Use this to verify that test data has been seeded.',
  })
  @SwaggerResponse({ status: 200, description: 'Environment status' })
  async getStatus() {
    return this.devTestService.getStatus();
  }

  /**
   * GET /dev/test-certificates
   * Lists all available test certificates with their PEM data.
   * This is the "certificate selector" — pick one and use it.
   */
  @Public()
  @Get('test-certificates')
  @ApiOperation({
    summary: '📜 List available test certificates',
    description:
      'Returns all test certificates with their PEM data and device fingerprints.\n\n' +
      '**How to use:**\n' +
      '1. Call this endpoint to see all available certificates\n' +
      '2. Copy the `certificatePem` and `deviceFingerprint` from any entry\n' +
      '3. Use them in `POST /auth/certificate-login`\n\n' +
      '**Available roles:** SUPER_ADMIN, ADMIN, MANAGER, EMPLOYEE\n\n' +
      '⚠️ Run `npx ts-node scripts/generate-test-certs.ts` first if empty.',
  })
  @SwaggerResponse({
    status: 200,
    description: 'List of certificates with PEM data, fingerprints, and role info',
  })
  async listCertificates() {
    const certs = await this.devTestService.getTestCertificates();

    if (certs.length === 0) {
      return {
        message: 'No test certificates found.',
        hint: 'Run: npx ts-node scripts/generate-test-certs.ts',
        certificates: [],
      };
    }

    return {
      message: `${certs.length} test certificate(s) available. Pick one and use it with POST /auth/certificate-login`,
      howToUse: {
        step1: 'Find the role you want to test (e.g., ADMIN)',
        step2: 'Copy the "certificatePem" value',
        step3: 'Copy the "deviceFingerprint" value',
        step4: 'Go to POST /auth/certificate-login',
        step5: 'Paste both values in the request body',
        step6: 'You will receive JWT access + refresh tokens',
      },
      certificates: certs,
    };
  }

  /**
   * POST /dev/quick-cert-login
   * One-click certificate login — just specify the employee ID.
   * Automatically finds the matching certificate and calls certificate-login.
   */
  @Public()
  @Post('quick-cert-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '⚡ Quick certificate login (by employee ID)',
    description:
      'Shortcut for testing — logs in using a pre-generated test certificate.\n\n' +
      'Instead of manually copying PEM strings, just specify the employee ID:\n' +
      '- `EMP-SA-001` → SUPER_ADMIN\n' +
      '- `EMP-ADM-001` → ADMIN\n' +
      '- `EMP-MGR-001` → MANAGER\n' +
      '- `EMP-EMP-001` → EMPLOYEE\n\n' +
      'Returns JWT tokens just like the real `/auth/certificate-login` endpoint.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['employeeId'],
      properties: {
        employeeId: {
          type: 'string',
          example: 'EMP-SA-001',
          description: 'Employee ID (e.g., EMP-SA-001 for SUPER_ADMIN)',
          enum: ['EMP-SA-001', 'EMP-ADM-001', 'EMP-MGR-001', 'EMP-EMP-001'],
        },
      },
    },
  })
  @SwaggerResponse({ status: 200, description: 'Certificate login successful — JWT tokens returned' })
  @SwaggerResponse({ status: 400, description: 'No test certificate found for this employee ID' })
  async quickCertLogin(@Body() dto: QuickCertLoginDto) {
    const certData = await this.devTestService.getCertificateByEmployeeId(dto.employeeId);

    if (!certData) {
      throw new BadRequestException(
        `No active test certificate found for employee ${dto.employeeId}. ` +
        'Run: npx ts-node scripts/generate-test-certs.ts',
      );
    }

    // Call the real auth service's certificate login
    const result = await this.authService.certificateLogin(
      {
        certificate: certData.certificate,
        deviceFingerprint: certData.deviceFingerprint,
      },
      '127.0.0.1',
      'SecureVault-DevTest/1.0',
    );

    return {
      message: `✅ Certificate login successful for ${dto.employeeId}`,
      ...result,
    };
  }

  /**
   * GET /dev/test-certificates/:role
   * Get the certificate for a specific role — convenience method.
   */
  @Public()
  @Get('test-certificates/by-role/:role')
  @ApiOperation({
    summary: '🔍 Get certificate by role',
    description:
      'Returns the test certificate for a specific role.\n\n' +
      'Valid roles: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `EMPLOYEE`',
  })
  async getCertificateByRole(@Body() _: any, ...args: any[]) {
    // We'll use a param-based approach
    const certs = await this.devTestService.getTestCertificates();
    return certs;
  }
}
