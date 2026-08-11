/** Defines role capabilities without importing the authenticated Convex request boundary. */

import type { WorkspacePermission, WorkspaceRole } from "./domainValidators";

export const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<WorkspacePermission>> = {
  owner: new Set([
    "workspace:read",
    "workspace:manage",
    "members:manage",
    "content:read",
    "content:personalize",
    "content:write",
    "runs:execute",
  ]),
  admin: new Set([
    "workspace:read",
    "workspace:manage",
    "members:manage",
    "content:read",
    "content:personalize",
    "content:write",
    "runs:execute",
  ]),
  member: new Set([
    "workspace:read",
    "content:read",
    "content:personalize",
    "content:write",
    "runs:execute",
  ]),
  viewer: new Set(["workspace:read", "content:read", "content:personalize"]),
};

export function permissionsForRole(role: WorkspaceRole): WorkspacePermission[] {
  return [...ROLE_PERMISSIONS[role]];
}
