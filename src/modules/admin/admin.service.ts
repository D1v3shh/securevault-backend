import {
  Injectable, Logger, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/interfaces/audit.interface';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { QueryUsersDto } from '../users/dto/query-users.dto';
import { Role, ROLE_HIERARCHY } from '../permissions/constants/roles.enum';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create a new user account.
   * Only SUPER_ADMIN and ADMIN can create users.
   * Admins cannot create users with equal or higher roles.
   */
  async createUser(dto: CreateUserDto, admin: AuthenticatedUser, ip: string) {
    // Prevent role escalation
    const targetRole = dto.role || Role.EMPLOYEE;
    this.validateRoleChange(admin, targetRole);

    const result = await this.usersService.createUser(dto, admin.userId);

    await this.auditService.log({
      action: AuditAction.USER_CREATE,
      resource: 'user',
      resourceId: result.user.uuid,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: admin.role,
      ipAddress: ip,
      metadata: {
        createdUserEmail: dto.email,
        assignedRole: targetRole,
      },
      status: 'success',
    });

    return {
      user: {
        id: result.user._id,
        uuid: result.user.uuid,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
        isActive: result.user.isActive,
      },
      temporaryPassword: result.temporaryPassword,
    };
  }

  async getUsers(query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  async getUserById(id: string) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateUser(id: string, dto: UpdateUserDto, admin: AuthenticatedUser, ip: string) {
    const user = await this.usersService.updateUser(id, dto);

    await this.auditService.log({
      action: AuditAction.USER_UPDATE,
      resource: 'user',
      resourceId: user.uuid,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: admin.role,
      ipAddress: ip,
      metadata: { updatedFields: Object.keys(dto) },
      status: 'success',
    });

    return user;
  }

  async activateUser(id: string, admin: AuthenticatedUser, ip: string) {
    const user = await this.usersService.activateUser(id);

    await this.auditService.log({
      action: AuditAction.USER_ACTIVATE,
      resource: 'user',
      resourceId: user.uuid,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: admin.role,
      ipAddress: ip,
      status: 'success',
    });

    return user;
  }

  async deactivateUser(id: string, admin: AuthenticatedUser, ip: string) {
    // Prevent self-deactivation
    if (id === admin.userId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    const user = await this.usersService.deactivateUser(id);

    await this.auditService.log({
      action: AuditAction.USER_DEACTIVATE,
      resource: 'user',
      resourceId: user.uuid,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: admin.role,
      ipAddress: ip,
      status: 'success',
    });

    return user;
  }

  async resetUserPassword(id: string, admin: AuthenticatedUser, ip: string) {
    const result = await this.usersService.resetPassword(id);

    await this.auditService.log({
      action: AuditAction.PASSWORD_RESET,
      resource: 'user',
      resourceId: id,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: admin.role,
      ipAddress: ip,
      status: 'success',
    });

    return result;
  }

  async changeUserRole(id: string, role: Role, admin: AuthenticatedUser, ip: string) {
    // Only SUPER_ADMIN can change roles
    if (admin.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can change user roles');
    }

    // Prevent self-demotion
    if (id === admin.userId) {
      throw new ForbiddenException('You cannot change your own role');
    }

    this.validateRoleChange(admin, role);
    const user = await this.usersService.changeRole(id, role);

    await this.auditService.log({
      action: AuditAction.USER_ROLE_CHANGE,
      resource: 'user',
      resourceId: user.uuid,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: admin.role,
      ipAddress: ip,
      metadata: { newRole: role },
      status: 'success',
    });

    return user;
  }

  async getAuditLogs(query: any) {
    return this.auditService.findAll(query);
  }

  /**
   * Validates that the admin has sufficient privileges for the target role.
   */
  private validateRoleChange(admin: AuthenticatedUser, targetRole: Role): void {
    const adminLevel = ROLE_HIERARCHY[admin.role as Role] || 0;
    const targetLevel = ROLE_HIERARCHY[targetRole] || 0;

    if (targetLevel >= adminLevel) {
      throw new ForbiddenException(
        'You cannot assign a role equal to or higher than your own',
      );
    }
  }
}
