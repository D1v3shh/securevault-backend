import { Role } from '../../permissions/constants/roles.enum';

/**
 * JWT access token payload structure.
 */
export interface JwtPayload {
  sub: string;       // User MongoDB _id
  uuid: string;      // User UUID
  email: string;
  role: Role;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

/**
 * Authenticated user object attached to request.
 */
export interface AuthenticatedUser {
  userId: string;
  uuid: string;
  email: string;
  role: Role;
}
