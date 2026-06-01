import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService } from '../admin.service';
import { UsersService } from '../../users/users.service';
import { AuditService } from '../../audit/audit.service';
import { SetupService } from '../../setup/setup.service';
import { DevicesService } from '../../devices/devices.service';
import { Role } from '../../permissions/constants/roles.enum';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';

describe('AdminService', () => {
  let service: AdminService;
  let usersService: jest.Mocked<Partial<UsersService>>;
  let auditService: jest.Mocked<Partial<AuditService>>;
  let setupService: jest.Mocked<Partial<SetupService>>;
  let devicesService: jest.Mocked<Partial<DevicesService>>;

  const superAdmin: AuthenticatedUser = {
    userId: 'super-admin-id',
    uuid: 'sa-uuid',
    email: 'superadmin@test.com',
    role: Role.SUPER_ADMIN,
  };

  const admin: AuthenticatedUser = {
    userId: 'admin-id',
    uuid: 'admin-uuid',
    email: 'admin@test.com',
    role: Role.ADMIN,
  };

  const mockUser = {
    _id: 'user-id',
    uuid: 'user-uuid',
    email: 'user@test.com',
    firstName: 'Test',
    lastName: 'User',
    role: Role.EMPLOYEE,
    isActive: true,
  };

  beforeEach(async () => {
    usersService = {
      createUser: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      updateUser: jest.fn(),
      activateUser: jest.fn(),
      deactivateUser: jest.fn(),
      resetPassword: jest.fn(),
      changeRole: jest.fn(),
    };

    auditService = {
      log: jest.fn(),
      findAll: jest.fn(),
    };

    setupService = {
      createEnrollmentToken: jest.fn(),
    };

    devicesService = {
      findAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: UsersService, useValue: usersService },
        { provide: AuditService, useValue: auditService },
        { provide: SetupService, useValue: setupService },
        { provide: DevicesService, useValue: devicesService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Create User ──────────────────────────────────────

  describe('createUser', () => {
    it('should create user and audit the action', async () => {
      usersService.createUser!.mockResolvedValue({
        user: mockUser as any,
        temporaryPassword: 'temp-pass-123',
      });

      const result = await service.createUser(
        { email: 'new@test.com', firstName: 'New', lastName: 'User' },
        superAdmin,
        '127.0.0.1',
      );

      expect(result.user.email).toBe('user@test.com');
      expect(result.temporaryPassword).toBe('temp-pass-123');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.create' }),
      );
    });

    it('should prevent admin from creating users with equal role', async () => {
      await expect(
        service.createUser(
          { email: 'new@test.com', firstName: 'New', lastName: 'User', role: Role.ADMIN },
          admin,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should prevent admin from creating users with higher role', async () => {
      await expect(
        service.createUser(
          { email: 'new@test.com', firstName: 'New', lastName: 'User', role: Role.SUPER_ADMIN },
          admin,
          '127.0.0.1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow super admin to create admin user', async () => {
      usersService.createUser!.mockResolvedValue({
        user: { ...mockUser, role: Role.ADMIN } as any,
        temporaryPassword: 'pass',
      });

      const result = await service.createUser(
        { email: 'new-admin@test.com', firstName: 'Admin', lastName: 'User', role: Role.ADMIN },
        superAdmin,
        '127.0.0.1',
      );

      expect(result.user).toBeDefined();
    });
  });

  // ─── Deactivate User ────────────────────────────────

  describe('deactivateUser', () => {
    it('should deactivate user and audit', async () => {
      usersService.deactivateUser!.mockResolvedValue(mockUser as any);

      await service.deactivateUser('user-id', admin, '127.0.0.1');

      expect(usersService.deactivateUser).toHaveBeenCalledWith('user-id');
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should prevent self-deactivation', async () => {
      await expect(
        service.deactivateUser('admin-id', admin, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Change User Role ────────────────────────────────

  describe('changeUserRole', () => {
    it('should allow SUPER_ADMIN to change role', async () => {
      usersService.changeRole!.mockResolvedValue({ ...mockUser, role: Role.MANAGER } as any);

      const result = await service.changeUserRole('user-id', Role.MANAGER, superAdmin, '127.0.0.1');

      expect(result.role).toBe(Role.MANAGER);
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should deny non-SUPER_ADMIN from changing roles', async () => {
      await expect(
        service.changeUserRole('user-id', Role.MANAGER, admin, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should prevent self-role-change', async () => {
      await expect(
        service.changeUserRole('super-admin-id', Role.ADMIN, superAdmin, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Get User By ID ──────────────────────────────────

  describe('getUserById', () => {
    it('should return user when found', async () => {
      usersService.findById!.mockResolvedValue(mockUser as any);

      const result = await service.getUserById('user-id');
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user not found', async () => {
      usersService.findById!.mockResolvedValue(null);

      await expect(service.getUserById('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Enrollment Tokens ──────────────────────────────

  describe('createEnrollmentToken', () => {
    it('should delegate to SetupService', async () => {
      const tokenResult = { token: 'enr_abc', expiresAt: new Date() };
      setupService.createEnrollmentToken!.mockResolvedValue(tokenResult);

      const result = await service.createEnrollmentToken(
        { userId: 'user-id', employeeId: 'EMP001', expiresInHours: 24, maxDevices: 1 },
        superAdmin,
        '127.0.0.1',
      );

      expect(setupService.createEnrollmentToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-id',
          employeeId: 'EMP001',
          createdBy: 'super-admin-id',
          ipAddress: '127.0.0.1',
        }),
      );
      expect(result).toEqual(tokenResult);
    });
  });

  // ─── Delegation Methods ──────────────────────────────

  describe('delegation methods', () => {
    it('getUsers should delegate to UsersService.findAll', async () => {
      usersService.findAll!.mockResolvedValue({ data: [], meta: {} } as any);

      await service.getUsers({ page: 1, limit: 20 });

      expect(usersService.findAll).toHaveBeenCalled();
    });

    it('getDevices should delegate to DevicesService.findAll', async () => {
      devicesService.findAll!.mockResolvedValue({ data: [], meta: {} } as any);

      await service.getDevices({ page: 1, limit: 20 });

      expect(devicesService.findAll).toHaveBeenCalled();
    });

    it('getAuditLogs should delegate to AuditService.findAll', async () => {
      auditService.findAll!.mockResolvedValue({ data: [], meta: {} } as any);

      await service.getAuditLogs({ page: 1, limit: 20 });

      expect(auditService.findAll).toHaveBeenCalled();
    });
  });
});
