import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { UserEntity, UserDocument } from './schemas/user.schema';
import { RefreshTokenEntity, RefreshTokenDocument } from './schemas/refresh-token.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { Role } from '../permissions/constants/roles.enum';
import { APP_CONSTANTS } from '../../shared/constants/app.constants';
import { CryptoUtil } from '../../shared/utils/crypto.util';
import type { PaginatedResponse } from '../../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(UserEntity.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshTokenEntity.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
  ) {}

  /**
   * Create a new user account (admin-only).
   * Generates a temporary password if not provided.
   */
  async createUser(dto: CreateUserDto, createdBy: string): Promise<{ user: UserDocument; temporaryPassword: string }> {
    const existing = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const temporaryPassword = dto.temporaryPassword || this.generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, APP_CONSTANTS.BCRYPT_SALT_ROUNDS);

    const user = await this.userModel.create({
      email: dto.email.toLowerCase(),
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role || Role.EMPLOYEE,
      department: dto.department || null,
      jobTitle: dto.jobTitle || null,
      isFirstLogin: true,
      mustChangePassword: true,
      isActive: true,
      createdBy,
    });

    this.logger.log(`User created: ${user.email} (role: ${user.role}) by ${createdBy}`);
    return { user, temporaryPassword };
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase(), deletedAt: null });
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).where({ deletedAt: null });
  }

  async findByUuid(uuid: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ uuid, deletedAt: null });
  }

  /**
   * Query users with pagination, search, and filters.
   */
  async findAll(query: QueryUsersDto): Promise<PaginatedResponse<UserDocument>> {
    const { page = 1, limit = 20, search, role, isActive, department } = query;
    const filter: Record<string, any> = { deletedAt: null };

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { email: { $regex: escapedSearch, $options: 'i' } },
        { firstName: { $regex: escapedSearch, $options: 'i' } },
        { lastName: { $regex: escapedSearch, $options: 'i' } },
      ];
    }
    if (role) filter.role = role;
    if (typeof isActive === 'boolean') filter.isActive = isActive;
    if (department) filter.department = department;

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('-passwordHash -temporaryPassword')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(id, { $set: dto }, { returnDocument: 'after' });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async activateUser(id: string): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      id,
      { isActive: true, lockoutUntil: null, failedLoginAttempts: 0 },
      { returnDocument: 'after' },
    );
    if (!user) throw new NotFoundException('User not found');
    this.logger.log(`User activated: ${user.email}`);
    return user;
  }

  async deactivateUser(id: string): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(id, { isActive: false }, { returnDocument: 'after' });
    if (!user) throw new NotFoundException('User not found');
    // Revoke all refresh tokens
    await this.refreshTokenModel.updateMany({ userId: user._id }, { isRevoked: true });
    this.logger.log(`User deactivated: ${user.email}`);
    return user;
  }

  async resetPassword(id: string): Promise<{ temporaryPassword: string }> {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, APP_CONSTANTS.BCRYPT_SALT_ROUNDS);

    user.passwordHash = passwordHash;
    user.mustChangePassword = true;
    user.isFirstLogin = true;
    user.failedLoginAttempts = 0;
    user.lockoutUntil = null;
    await user.save();

    // Revoke all refresh tokens
    await this.refreshTokenModel.updateMany({ userId: user._id }, { isRevoked: true });
    this.logger.log(`Password reset for user: ${user.email}`);
    return { temporaryPassword };
  }

  async changeRole(id: string, role: Role): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(id, { role }, { returnDocument: 'after' });
    if (!user) throw new NotFoundException('User not found');
    this.logger.log(`Role changed for ${user.email}: ${role}`);
    return user;
  }

  async updatePassword(id: string, newPasswordHash: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(id, {
      passwordHash: newPasswordHash,
      mustChangePassword: false,
      isFirstLogin: false,
      temporaryPassword: null,
      passwordChangedAt: new Date(),
    });
  }

  async recordLoginAttempt(id: string, success: boolean, ip: string): Promise<void> {
    if (success) {
      await this.userModel.findByIdAndUpdate(id, {
        failedLoginAttempts: 0,
        lockoutUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      });
    } else {
      const user = await this.userModel.findById(id);
      if (!user) return;

      const attempts = user.failedLoginAttempts + 1;
      const update: any = { failedLoginAttempts: attempts };

      if (attempts >= APP_CONSTANTS.MAX_FAILED_LOGIN_ATTEMPTS) {
        update.lockoutUntil = new Date(
          Date.now() + APP_CONSTANTS.LOCKOUT_DURATION_MINUTES * 60 * 1000,
        );
        this.logger.warn(`Account locked: ${user.email} after ${attempts} failed attempts`);
      }

      await this.userModel.findByIdAndUpdate(id, update);
    }
  }

  async isAccountLocked(user: UserDocument): Promise<boolean> {
    if (!user.lockoutUntil) return false;
    if (new Date() > user.lockoutUntil) {
      // Lockout expired — reset
      await this.userModel.findByIdAndUpdate(user._id, {
        lockoutUntil: null,
        failedLoginAttempts: 0,
      });
      return false;
    }
    return true;
  }

  /**
   * Seed the initial super admin account.
   */
  async seedSuperAdmin(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ): Promise<void> {
    const exists = await this.userModel.findOne({ email: email.toLowerCase() });
    if (exists) {
      this.logger.log('Super admin already exists — skipping seed');
      return;
    }

    const passwordHash = await bcrypt.hash(password, APP_CONSTANTS.BCRYPT_SALT_ROUNDS);
    await this.userModel.create({
      email: email.toLowerCase(),
      passwordHash,
      firstName,
      lastName,
      role: Role.SUPER_ADMIN,
      isActive: true,
      isFirstLogin: false,
      mustChangePassword: false,
      createdBy: 'system',
    });

    this.logger.log(`✅ Super admin seeded: ${email}`);
  }

  private generateTemporaryPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    const randomBytes = CryptoUtil.generateRandomKey(16);
    for (let i = 0; i < 16; i++) {
      password += chars[randomBytes[i] % chars.length];
    }
    return password;
  }
}
