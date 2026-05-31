/**
 * Permission levels for file shares.
 * Hierarchical: each level includes the permissions of all levels below it.
 *
 * VIEW         → View metadata + stream file contents
 * DOWNLOAD     → VIEW + download
 * EDIT         → DOWNLOAD + update file contents
 * FULL_ACCESS  → All actions
 */
export enum SharePermission {
  VIEW = 'VIEW',
  DOWNLOAD = 'DOWNLOAD',
  EDIT = 'EDIT',
  FULL_ACCESS = 'FULL_ACCESS',
}

/**
 * Hierarchical permission weight — higher value = more privilege.
 */
export const SHARE_PERMISSION_HIERARCHY: Record<SharePermission, number> = {
  [SharePermission.VIEW]: 10,
  [SharePermission.DOWNLOAD]: 20,
  [SharePermission.EDIT]: 30,
  [SharePermission.FULL_ACCESS]: 100,
};

/**
 * Actions that can be performed on a shared file.
 */
export enum ShareAction {
  VIEW = 'VIEW',
  DOWNLOAD = 'DOWNLOAD',
  EDIT = 'EDIT',
  DELETE = 'DELETE',
  SHARE = 'SHARE',
}

/**
 * Minimum permission required for each action.
 */
export const ACTION_REQUIRED_PERMISSION: Record<ShareAction, SharePermission> = {
  [ShareAction.VIEW]: SharePermission.VIEW,
  [ShareAction.DOWNLOAD]: SharePermission.DOWNLOAD,
  [ShareAction.EDIT]: SharePermission.EDIT,
  [ShareAction.DELETE]: SharePermission.FULL_ACCESS,
  [ShareAction.SHARE]: SharePermission.FULL_ACCESS,
};

/**
 * Check if a given permission level allows a specific action.
 */
export function hasPermissionForAction(
  userPermission: SharePermission,
  requiredAction: ShareAction,
): boolean {
  const requiredPermission = ACTION_REQUIRED_PERMISSION[requiredAction];
  return (
    SHARE_PERMISSION_HIERARCHY[userPermission] >=
    SHARE_PERMISSION_HIERARCHY[requiredPermission]
  );
}
