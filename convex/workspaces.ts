/** Public workspace creation and membership-scoped discovery. */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { convexConfig } from "./config";
import { createPublicId, normalizeLimit, requireText } from "./lib/domainValidation";
import {
  workspaceMembershipStatusValidator,
  workspacePermissionValidator,
  workspaceRoleValidator,
  workspaceStorageModeValidator,
} from "./lib/domainValidators";
import { permissionsForRole, requireAppUser } from "./lib/workspaceAuth";

const workspaceSummaryValidator = v.object({
  id: v.id("workspaces"),
  publicId: v.string(),
  name: v.string(),
  storageMode: workspaceStorageModeValidator,
  schemaVersion: v.number(),
  role: workspaceRoleValidator,
  membershipStatus: workspaceMembershipStatusValidator,
  permissions: v.array(workspacePermissionValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const getByPublicId = query({
  args: { publicId: v.string() },
  returns: v.union(workspaceSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await requireAppUser(ctx);
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (index) => index.eq("publicId", args.publicId))
      .unique();
    if (!workspace) return null;
    const membership = await ctx.db
      .query("workspace_memberships")
      .withIndex("by_workspace_user", (index) =>
        index.eq("workspaceId", workspace._id).eq("userId", user._id),
      )
      .unique();
    if (membership?.status !== "active") return null;
    return {
      id: workspace._id,
      publicId: workspace.publicId,
      name: workspace.name,
      storageMode: workspace.storageMode,
      schemaVersion: workspace.schemaVersion,
      role: membership.role,
      membershipStatus: membership.status,
      permissions: permissionsForRole(membership.role),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    items: v.array(workspaceSummaryValidator),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await requireAppUser(ctx);
    const limit = normalizeLimit(args.limit);
    const memberships = await ctx.db
      .query("workspace_memberships")
      .withIndex("by_user_status", (index) => index.eq("userId", user._id).eq("status", "active"))
      .take(limit + 1);
    const hasMore = memberships.length > limit;
    const visibleMemberships = memberships.slice(0, limit);
    const items = [];

    for (const membership of visibleMemberships) {
      const workspace = await ctx.db.get(membership.workspaceId);
      if (!workspace) continue;
      items.push({
        id: workspace._id,
        publicId: workspace.publicId,
        name: workspace.name,
        storageMode: workspace.storageMode,
        schemaVersion: workspace.schemaVersion,
        role: membership.role,
        membershipStatus: membership.status,
        permissions: permissionsForRole(membership.role),
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      });
    }

    return { items, hasMore };
  },
});

export const create = mutation({
  args: {
    publicId: v.optional(v.string()),
    membershipPublicId: v.optional(v.string()),
    name: v.string(),
  },
  returns: workspaceSummaryValidator,
  handler: async (ctx, args) => {
    const user = await requireAppUser(ctx);
    const publicId = createPublicId("ws", args.publicId);
    const membershipPublicId = createPublicId("member", args.membershipPublicId);
    const name = requireText(
      args.name,
      "Workspace name",
      convexConfig.domain.limits.workspaceNameLength,
    );
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
      .unique();
    if (existing) {
      throw new Error("Workspace public ID already exists.");
    }

    const now = Date.now();
    const workspaceId = await ctx.db.insert("workspaces", {
      publicId,
      name,
      storageMode: "local",
      schemaVersion: convexConfig.domain.workspaceSchemaVersion,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
    const duplicateMembershipId = await ctx.db
      .query("workspace_memberships")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", workspaceId).eq("publicId", membershipPublicId),
      )
      .unique();
    if (duplicateMembershipId) {
      throw new Error("Membership public ID already exists.");
    }
    await ctx.db.insert("workspace_memberships", {
      publicId: membershipPublicId,
      workspaceId,
      userId: user._id,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: workspaceId,
      publicId,
      name,
      storageMode: "local" as const,
      schemaVersion: convexConfig.domain.workspaceSchemaVersion,
      role: "owner" as const,
      membershipStatus: "active" as const,
      permissions: permissionsForRole("owner"),
      createdAt: now,
      updatedAt: now,
    };
  },
});
