/** Workspace-scoped project queries and creation. */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { convexConfig } from "./config";
import { createPublicId, normalizeLimit, optionalText, requireText } from "./lib/domainValidation";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

const projectSummaryValidator = v.object({
  id: v.id("projects"),
  publicId: v.string(),
  workspaceId: v.id("workspaces"),
  name: v.string(),
  description: v.optional(v.string()),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(projectSummaryValidator),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:read");
    const limit = normalizeLimit(args.limit);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_workspace_updated_at", (index) => index.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(limit + 1);

    return {
      items: projects.slice(0, limit).map((project) => ({
        id: project._id,
        publicId: project.publicId,
        workspaceId: project.workspaceId,
        name: project.name,
        description: project.description,
        archivedAt: project.archivedAt,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })),
      hasMore: projects.length > limit,
    };
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    publicId: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: projectSummaryValidator,
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const publicId = createPublicId("project", args.publicId);
    const name = requireText(
      args.name,
      "Project name",
      convexConfig.domain.limits.projectNameLength,
    );
    const description = optionalText(
      args.description,
      "Project description",
      convexConfig.domain.limits.projectDescriptionLength,
    );
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", publicId),
      )
      .unique();
    if (existing) {
      throw new Error("Project public ID already exists in this workspace.");
    }

    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      publicId,
      workspaceId: args.workspaceId,
      name,
      description,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id: projectId,
      publicId,
      workspaceId: args.workspaceId,
      name,
      description,
      createdAt: now,
      updatedAt: now,
    };
  },
});
