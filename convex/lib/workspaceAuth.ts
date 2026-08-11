/** Resolves Better Auth callers to app users and enforces workspace permissions. */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";
import { localAnonymousWorkspacesEnabled } from "../env";
import type { WorkspacePermission } from "./domainValidators";
import { LOCAL_ANONYMOUS_AUTH_SUBJECT } from "./localIdentity";
import { ROLE_PERMISSIONS } from "./workspacePermissions";

export type { WorkspacePermission } from "./domainValidators";
export { permissionsForRole } from "./workspacePermissions";

type AuthenticatedCtx = QueryCtx | MutationCtx;

export async function requireAppUser(ctx: AuthenticatedCtx): Promise<Doc<"users">> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    if (localAnonymousWorkspacesEnabled) {
      const localUser = await ctx.db
        .query("users")
        .withIndex("by_auth_subject", (query) =>
          query.eq("authSubject", LOCAL_ANONYMOUS_AUTH_SUBJECT),
        )
        .unique();
      if (localUser) return localUser;
      throw new Error("Local workspace identity has not been initialized.");
    }
    throw new Error("Authentication required.");
  }

  const appUser = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (query) => query.eq("authSubject", authUser._id))
    .unique();
  if (!appUser) {
    throw new Error("Authenticated user has not been provisioned.");
  }
  return appUser;
}

export async function requireWorkspacePermission(
  ctx: AuthenticatedCtx,
  workspaceId: Id<"workspaces">,
  permission: WorkspacePermission,
): Promise<{
  user: Doc<"users">;
  membership: Doc<"workspace_memberships">;
}> {
  const user = await requireAppUser(ctx);
  const membership = await ctx.db
    .query("workspace_memberships")
    .withIndex("by_workspace_user", (query) =>
      query.eq("workspaceId", workspaceId).eq("userId", user._id),
    )
    .unique();

  if (membership?.status !== "active" || !ROLE_PERMISSIONS[membership.role].has(permission)) {
    // Keep missing-workspace and denied-membership responses indistinguishable.
    throw new Error("Workspace access denied.");
  }

  return { user, membership };
}
