import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from '../users.service';
import { UserEntity } from '../schemas/user.schema';
import { RefreshTokenEntity } from '../schemas/refresh-token.schema';
import { Role } from '../../permissions/constants/roles.enum';
import { APP_CONSTANTS } from '../../../shared/constants/app.constants';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

describe('UsersService', () => {
  let service: UsersService;
  let userModel: any;
  let refreshTokenModel: any;

  const mockUser = {
    _id: { toString: () => 'user-id-123' },
    uuid: 'uuid-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: Role.EMPLOYEE,
    passwordHash: 'hashed-password',
    isActive: true,
    isFirstLogin: false,
    mustChangePassword: false,
    failedLoginAttempts: 0,
    lockoutUntil: null,
    save: jest.fn(),
  };

  beforeEach(async () => {
    userModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };

    refreshTokenModel = {
      updateMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(UserEntity.name), useValue: userModel },
        { provide: getModelToken(RefreshTokenEntity.name), useValue: refreshTokenModel },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Create User ────────────────────────────────────────

  describe('createUser', () => {
    it('should create a new user with generated temporary password', async () => {
      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);

      const result = await service.createUser(
        { email: 'new@example.com', firstName: 'New', lastName: 'User' },
        'admin-id',
      );

      expect(result.user).toBeDefined();
      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword.length).toBe(16);
      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          isFirstLogin: true,
          mustChangePassword: true,
          isActive: true,
          createdBy: 'admin-id',
        }),
      );
    });

    it('should use provided temporary password', async () => {
      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);

      const result = await service.createUser(
        { email: 'new@example.com', firstName: 'New', lastName: 'User', temporaryPassword: 'custom-pass' },
        'admin-id',
      );

      expect(result.temporaryPassword).toBe('custom-pass');
    });

    it('should throw ConflictException for duplicate email', async () => {
      userModel.findOne.mockResolvedValue(mockUser);

      await expect(
        service.createUser(
          { email: 'test@example.com', firstName: 'Test', lastName: 'User' },
          'admin-id',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should normalize email to lowercase', async () => {
      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);

      await service.createUser(
        { email: 'TEST@Example.COM', firstName: 'Test', lastName: 'User' },
        'admin-id',
      );

      expect(userModel.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@example.com' }),
      );
    });

    it('should default to EMPLOYEE role when not specified', async () => {
      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);

      await service.createUser(
        { email: 'new@example.com', firstName: 'New', lastName: 'User' },
        'admin-id',
      );

      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: Role.EMPLOYEE }),
      );
    });
  });

  // ─── Find Methods ──────────────────────────────────────

  describe('findByEmail', () => {
    it('should find user by email (case-insensitive)', async () => {
      userModel.findOne.mockResolvedValue(mockUser);

      const result = await service.findByEmail('TEST@example.com');

      expect(userModel.findOne).toHaveBeenCalledWith({
        email: 'test@example.com',
        deletedAt: null,
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when user not found', async () => {
      userModel.findOne.mockResolvedValue(null);

      expect(await service.findByEmail('nope@example.com')).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find user by id excluding deleted', async () => {
      const whereChain = { where: jest.fn().mockReturnThis() };
      Object.assign(whereChain, mockUser);
      userModel.findById.mockReturnValue({
        where: jest.fn().mockResolvedValue(mockUser),
      });

      const result = await service.findById('user-id-123');
      expect(result).toEqual(mockUser);
    });
  });

  describe('findByUuid', () => {
    it('should find user by uuid', async () => {
      userModel.findOne.mockResolvedValue(mockUser);

      const result = await service.findByUuid('uuid-123');

      expect(userModel.findOne).toHaveBeenCalledWith({ uuid: 'uuid-123', deletedAt: null });
      expect(result).toEqual(mockUser);
    });
  });

  // ─── Query Users (Pagination) ──────────────────────────

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const users = [mockUser];
      const execFn = jest.fn().mockResolvedValue(users);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      const selectFn = jest.fn().mockReturnValue({ sort: sortFn });
      userModel.find.mockReturnValue({ select: selectFn });
      userModel.countDocuments.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toEqual(users);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
    });

    it('should apply search filter', async () => {
      const execFn = jest.fn().mockResolvedValue([]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      const selectFn = jest.fn().mockReturnValue({ sort: sortFn });
      userModel.find.mockReturnValue({ select: selectFn });
      userModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ search: 'test' });

      const filterArg = userModel.find.mock.calls[0][0];
      expect(filterArg.$or).toBeDefined();
      expect(filterArg.$or).toHaveLength(3);
    });

    it('should apply role and isActive filters', async () => {
      const execFn = jest.fn().mockResolvedValue([]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      const selectFn = jest.fn().mockReturnValue({ sort: sortFn });
      userModel.find.mockReturnValue({ select: selectFn });
      userModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ role: Role.ADMIN, isActive: true });

      const filterArg = userModel.find.mock.calls[0][0];
      expect(filterArg.role).toBe(Role.ADMIN);
      expect(filterArg.isActive).toBe(true);
    });

    it('should calculate pagination metadata correctly', async () => {
      const execFn = jest.fn().mockResolvedValue([mockUser]);
      const limitFn = jest.fn().mockReturnValue({ exec: execFn });
      const skipFn = jest.fn().mockReturnValue({ limit: limitFn });
      const sortFn = jest.fn().mockReturnValue({ skip: skipFn });
      const selectFn = jest.fn().mockReturnValue({ sort: sortFn });
      userModel.find.mockReturnValue({ select: selectFn });
      userModel.countDocuments.mockResolvedValue(50);

      const result = await service.findAll({ page: 2, limit: 10 });

      expect(result.meta.totalPages).toBe(5);
      expect(result.meta.hasNextPage).toBe(true);
      expect(result.meta.hasPreviousPage).toBe(true);
    });
  });

  // ─── Update User ──────────────────────────────────────

  describe('updateUser', () => {
    it('should update user and return updated document', async () => {
      userModel.findByIdAndUpdate.mockResolvedValue(mockUser);

      const result = await service.updateUser('user-id-123', { firstName: 'Updated' });

      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user not found', async () => {
      userModel.findByIdAndUpdate.mockResolvedValue(null);

      await expect(service.updateUser('bad-id', { firstName: 'X' }))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ─── Activate/Deactivate ──────────────────────────────

  describe('activateUser', () => {
    it('should activate user and reset lockout', async () => {
      userModel.findByIdAndUpdate.mockResolvedValue(mockUser);

      const result = await service.activateUser('user-id-123');

      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-123',
        { isActive: true, lockoutUntil: null, failedLoginAttempts: 0 },
        { returnDocument: 'after' },
      );
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user not found', async () => {
      userModel.findByIdAndUpdate.mockResolvedValue(null);

      await expect(service.activateUser('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivateUser', () => {
    it('should deactivate user and revoke all refresh tokens', async () => {
      userModel.findByIdAndUpdate.mockResolvedValue(mockUser);

      const result = await service.deactivateUser('user-id-123');

      expect(refreshTokenModel.updateMany).toHaveBeenCalledWith(
        { userId: mockUser._id },
        { isRevoked: true },
      );
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user not found', async () => {
      userModel.findByIdAndUpdate.mockResolvedValue(null);

      await expect(service.deactivateUser('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Reset Password ──────────────────────────────────

  describe('resetPassword', () => {
    it('should reset password and revoke tokens', async () => {
      userModel.findById.mockResolvedValue({ ...mockUser, save: jest.fn() });

      const result = await service.resetPassword('user-id-123');

      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword.length).toBe(16);
      expect(refreshTokenModel.updateMany).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user not found', async () => {
      userModel.findById.mockResolvedValue(null);

      await expect(service.resetPassword('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Change Role ──────────────────────────────────────

  describe('changeRole', () => {
    it('should change user role', async () => {
      userModel.findByIdAndUpdate.mockResolvedValue({ ...mockUser, role: Role.MANAGER });

      const result = await service.changeRole('user-id-123', Role.MANAGER);

      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-123',
        { role: Role.MANAGER },
        { returnDocument: 'after' },
      );
      expect(result.role).toBe(Role.MANAGER);
    });

    it('should throw NotFoundException when user not found', async () => {
      userModel.findByIdAndUpdate.mockResolvedValue(null);

      await expect(service.changeRole('bad-id', Role.ADMIN)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Login Attempt Recording ──────────────────────────

  describe('recordLoginAttempt', () => {
    it('should reset failed attempts on success', async () => {
      await service.recordLoginAttempt('user-id-123', true, '127.0.0.1');

      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-123',
        expect.objectContaining({
          failedLoginAttempts: 0,
          lockoutUntil: null,
        }),
      );
    });

    it('should increment failed attempts on failure', async () => {
      userModel.findById.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 1,
      });

      await service.recordLoginAttempt('user-id-123', false, '127.0.0.1');

      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-123',
        expect.objectContaining({ failedLoginAttempts: 2 }),
      );
    });

    it('should lock account after max failed attempts', async () => {
      userModel.findById.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: APP_CONSTANTS.MAX_FAILED_LOGIN_ATTEMPTS - 1,
        email: 'test@example.com',
      });

      await service.recordLoginAttempt('user-id-123', false, '127.0.0.1');

      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-123',
        expect.objectContaining({
          failedLoginAttempts: APP_CONSTANTS.MAX_FAILED_LOGIN_ATTEMPTS,
          lockoutUntil: expect.any(Date),
        }),
      );
    });

    it('should handle user not found on failure gracefully', async () => {
      userModel.findById.mockResolvedValue(null);

      // Should not throw
      await service.recordLoginAttempt('bad-id', false, '127.0.0.1');
    });
  });

  // ─── Account Lockout Check ────────────────────────────

  describe('isAccountLocked', () => {
    it('should return false when no lockout', async () => {
      const result = await service.isAccountLocked({ lockoutUntil: null } as any);
      expect(result).toBe(false);
    });

    it('should return true when lockout is active', async () => {
      const result = await service.isAccountLocked({
        lockoutUntil: new Date(Date.now() + 60000),
      } as any);
      expect(result).toBe(true);
    });

    it('should reset lockout when expired', async () => {
      const user = {
        _id: 'user-id-123',
        lockoutUntil: new Date(Date.now() - 1000),
      };
      userModel.findByIdAndUpdate.mockResolvedValue(undefined);

      const result = await service.isAccountLocked(user as any);

      expect(result).toBe(false);
      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-123',
        { lockoutUntil: null, failedLoginAttempts: 0 },
      );
    });
  });

  // ─── Seed Super Admin ────────────────────────────────

  describe('seedSuperAdmin', () => {
    it('should create super admin when not exists', async () => {
      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);

      await service.seedSuperAdmin('admin@test.com', 'password', 'Super', 'Admin');

      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'admin@test.com',
          role: Role.SUPER_ADMIN,
          isActive: true,
          isFirstLogin: false,
          mustChangePassword: false,
          createdBy: 'system',
        }),
      );
    });

    it('should skip when super admin already exists', async () => {
      userModel.findOne.mockResolvedValue(mockUser);

      await service.seedSuperAdmin('admin@test.com', 'password', 'Super', 'Admin');

      expect(userModel.create).not.toHaveBeenCalled();
    });
  });
});
