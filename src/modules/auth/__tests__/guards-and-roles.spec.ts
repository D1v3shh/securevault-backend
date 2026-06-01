import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Role, ROLE_HIERARCHY, hasHigherOrEqualRole, ADMIN_ROLES, USER_MANAGEMENT_ROLES } from '../../permissions/constants/roles.enum';

// ─── RolesGuard ─────────────────────────────────────────

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(user: any, requiredRoles: Role[] | undefined): ExecutionContext {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles as any);

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should allow access when no roles are required', () => {
    const context = createMockContext({ role: Role.EMPLOYEE }, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when roles array is empty', () => {
    const context = createMockContext({ role: Role.EMPLOYEE }, []);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user has required role', () => {
    const context = createMockContext({ role: Role.ADMIN }, [Role.ADMIN, Role.SUPER_ADMIN]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user lacks required role', () => {
    const context = createMockContext({ role: Role.EMPLOYEE }, [Role.ADMIN]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when no user on request', () => {
    const context = createMockContext(undefined, [Role.ADMIN]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when user has no role property', () => {
    const context = createMockContext({}, [Role.ADMIN]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should include required roles in error message', () => {
    const context = createMockContext({ role: Role.EMPLOYEE }, [Role.ADMIN, Role.SUPER_ADMIN]);
    try {
      guard.canActivate(context);
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('ADMIN');
      expect(err.message).toContain('SUPER_ADMIN');
    }
  });
});

// ─── JwtAuthGuard ─────────────────────────────────────

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  it('should allow public routes to bypass auth', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should delegate to parent guard for non-public routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({}),
      }),
    } as unknown as ExecutionContext;

    // Parent canActivate would throw since there's no real strategy, 
    // but we just need to test that it's called (not return true)
    const parentSpy = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockReturnValue(true);

    expect(guard.canActivate(context)).toBe(true);
    expect(parentSpy).toHaveBeenCalled();

    parentSpy.mockRestore();
  });
});

// ─── Role Enum & Hierarchy ─────────────────────────────

describe('Role Enum & Hierarchy', () => {
  it('should define all roles', () => {
    expect(Role.SUPER_ADMIN).toBe('SUPER_ADMIN');
    expect(Role.ADMIN).toBe('ADMIN');
    expect(Role.MANAGER).toBe('MANAGER');
    expect(Role.EMPLOYEE).toBe('EMPLOYEE');
    expect(Role.VIEWER).toBe('VIEWER');
  });

  it('should have correct hierarchy ordering', () => {
    expect(ROLE_HIERARCHY[Role.SUPER_ADMIN]).toBeGreaterThan(ROLE_HIERARCHY[Role.ADMIN]);
    expect(ROLE_HIERARCHY[Role.ADMIN]).toBeGreaterThan(ROLE_HIERARCHY[Role.MANAGER]);
    expect(ROLE_HIERARCHY[Role.MANAGER]).toBeGreaterThan(ROLE_HIERARCHY[Role.EMPLOYEE]);
    expect(ROLE_HIERARCHY[Role.EMPLOYEE]).toBeGreaterThan(ROLE_HIERARCHY[Role.VIEWER]);
  });

  it('hasHigherOrEqualRole should return true for equal role', () => {
    expect(hasHigherOrEqualRole(Role.ADMIN, Role.ADMIN)).toBe(true);
  });

  it('hasHigherOrEqualRole should return true for higher role', () => {
    expect(hasHigherOrEqualRole(Role.SUPER_ADMIN, Role.EMPLOYEE)).toBe(true);
  });

  it('hasHigherOrEqualRole should return false for lower role', () => {
    expect(hasHigherOrEqualRole(Role.EMPLOYEE, Role.ADMIN)).toBe(false);
  });

  it('ADMIN_ROLES should contain SUPER_ADMIN and ADMIN', () => {
    expect(ADMIN_ROLES).toContain(Role.SUPER_ADMIN);
    expect(ADMIN_ROLES).toContain(Role.ADMIN);
    expect(ADMIN_ROLES).not.toContain(Role.MANAGER);
  });

  it('USER_MANAGEMENT_ROLES should contain SUPER_ADMIN and ADMIN', () => {
    expect(USER_MANAGEMENT_ROLES).toContain(Role.SUPER_ADMIN);
    expect(USER_MANAGEMENT_ROLES).toContain(Role.ADMIN);
    expect(USER_MANAGEMENT_ROLES).not.toContain(Role.EMPLOYEE);
  });
});
