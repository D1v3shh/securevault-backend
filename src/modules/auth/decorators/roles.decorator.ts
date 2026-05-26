import { SetMetadata } from '@nestjs/common';
import { Role } from '../../permissions/constants/roles.enum';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify which roles can access an endpoint.
 * Usage: @Roles(Role.SUPER_ADMIN, Role.ADMIN)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
