import {
  Controller, Get, Patch, Body, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as JwtPayloadNs from '../auth/interfaces/jwt-payload.interface';

/**
 * Users controller — for authenticated users to manage their own profile.
 * Admin user management is in the AdminController.
 */
@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser() user: JwtPayloadNs.AuthenticatedUser) {
    const profile = await this.usersService.findById(user.userId);
    if (!profile) {
      return { message: 'User not found' };
    }

    return {
      id: profile._id,
      uuid: profile.uuid,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      role: profile.role,
      department: profile.department,
      jobTitle: profile.jobTitle,
      isActive: profile.isActive,
      lastLoginAt: profile.lastLoginAt,
      createdAt: (profile as any).createdAt,
    };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Body() dto: { firstName?: string; lastName?: string; jobTitle?: string },
  ) {
    // Users can only update their own basic profile fields
    const allowedUpdate: any = {};
    if (dto.firstName) allowedUpdate.firstName = dto.firstName;
    if (dto.lastName) allowedUpdate.lastName = dto.lastName;
    if (dto.jobTitle) allowedUpdate.jobTitle = dto.jobTitle;

    const updated = await this.usersService.updateUser(user.userId, allowedUpdate);
    return {
      id: updated._id,
      uuid: updated.uuid,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      jobTitle: updated.jobTitle,
    };
  }
}
