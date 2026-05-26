import {
  Controller, Get, Post, Patch, Param, Query, Body, Req,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import * as express from 'express';
import { AdminService } from './admin.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import * as JwtPayloadNs from '../auth/interfaces/jwt-payload.interface';
import { Role } from '../permissions/constants/roles.enum';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { QueryUsersDto } from '../users/dto/query-users.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── User Management ─────────────────────────────

  @Post('users')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user account' })
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return this.adminService.createUser(dto, user, ip);
  }

  @Get('users')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'List all users with pagination and filters' })
  async getUsers(@Query() query: QueryUsersDto) {
    return this.adminService.getUsers(query);
  }

  @Get('users/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get user details by ID' })
  async getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Patch('users/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Update user details' })
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return this.adminService.updateUser(id, dto, user, ip);
  }

  @Post('users/:id/activate')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a user account' })
  async activateUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const result = await this.adminService.activateUser(id, user, ip);
    return { message: 'User activated', user: { id: result._id, email: result.email, isActive: result.isActive } };
  }

  @Post('users/:id/deactivate')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a user account' })
  async deactivateUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const result = await this.adminService.deactivateUser(id, user, ip);
    return { message: 'User deactivated', user: { id: result._id, email: result.email, isActive: result.isActive } };
  }

  @Post('users/:id/reset-password')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset user password (generates temporary password)' })
  async resetPassword(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return this.adminService.resetUserPassword(id, user, ip);
  }

  @Patch('users/:id/role')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Change user role (SUPER_ADMIN only)' })
  async changeRole(
    @Param('id') id: string,
    @Body('role') role: Role,
    @CurrentUser() user: JwtPayloadNs.AuthenticatedUser,
    @Req() req: express.Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const result = await this.adminService.changeUserRole(id, role, user, ip);
    return { message: 'Role updated', user: { id: result._id, email: result.email, role: result.role } };
  }

  // ─── Audit Logs ──────────────────────────────────

  @Get('audit-logs')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'View audit logs' })
  async getAuditLogs(
    @Query() query: any,
  ) {
    return this.adminService.getAuditLogs(query);
  }
}
