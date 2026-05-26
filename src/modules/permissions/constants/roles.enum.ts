/**
 * Application roles following enterprise hierarchy.
 * Ordered from highest to lowest privilege.
 */
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  EMPLOYEE = 'EMPLOYEE',
  VIEWER = 'VIEWER',
}

/**
 * Role hierarchy mapping — each role inherits permissions of roles below it.
 * SUPER_ADMIN > ADMIN > MANAGER > EMPLOYEE > VIEWER
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.SUPER_ADMIN]: 100,
  [Role.ADMIN]: 80,
  [Role.MANAGER]: 60,
  [Role.EMPLOYEE]: 40,
  [Role.VIEWER]: 20,
};

/**
 * Check if role A has higher or equal privilege than role B.
 */
export function hasHigherOrEqualRole(roleA: Role, roleB: Role): boolean {
  return ROLE_HIERARCHY[roleA] >= ROLE_HIERARCHY[roleB];
}

/**
 * Roles that can access admin interface.
 */
export const ADMIN_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
];

/**
 * Roles that can manage users.
 */
export const USER_MANAGEMENT_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.ADMIN,
];
