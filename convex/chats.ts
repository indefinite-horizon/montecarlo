/** Workspace-scoped chats and bounded branch-tree reads. */

import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { convexConfig } from "./config";
import { createPublicId, normalizeLimit, requireText } from "./lib/domainValidation";
import { branchAnchorTypeValidator, branchSelectionValidator } from "./lib/domainValidators";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

const chatSummaryValidator = v.object({
  id: v.id("chats"),
  publicId: v.string(),
  workspaceId: v.id("workspaces"),
  projectId: v.optional(v.id("projects")),
  title: v.string(),
  rootBranchId: v.id("chat_branches"),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const branchNodeValidator = v.object({
  id: v.id("chat_branches"),
  publicId: v.string(),
  parentBranchId: v.optional(v.id("chat_branches")),
  anchorType: branchAnchorTypeValidator,
  anchorSourceBranchId: v.optional(v.id("chat_branches")),
  anchorSourceMessageId: v.optional(v.id("messages")),
  anchorSelection: v.optional(branchSelectionValidator),
  anchorPrompt: v.optional(v.string()),
  contextMessageIds: v.array(v.id("messages")),
  contextPreview: v.optional(v.string()),
  depth: v.number(),
  createdAt: v.number(),
});

function toChatSummary(chat: Doc<"chats">) {
  if (!chat.rootBranchId) {
    throw new Error("Chat is missing its root branch.");
  }
  return {
    id: chat._id,
    publicId: chat.publicId,
    workspaceId: chat.workspaceId,
    projectId: chat.projectId,
    title: chat.title,
    rootBranchId: chat.rootBranchId,
    archivedAt: chat.archivedAt,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(chatSummaryValidator),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:read");
    const limit = normalizeLimit(args.limit);

    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.workspaceId !== args.workspaceId) {
        throw new Error("Project not found in this workspace.");
      }
      const chats = await ctx.db
        .query("chats")
        .withIndex("by_workspace_project_updated_at", (index) =>
          index.eq("workspaceId", args.workspaceId).eq("projectId", args.projectId),
        )
        .order("desc")
        .take(limit + 1);
      return {
        items: chats.slice(0, limit).map(toChatSummary),
        hasMore: chats.length > limit,
      };
    }

    const chats = await ctx.db
      .query("chats")
      .withIndex("by_workspace_updated_at", (index) => index.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(limit + 1);
    return {
      items: chats.slice(0, limit).map(toChatSummary),
      hasMore: chats.length > limit,
    };
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    publicId: v.optional(v.string()),
    rootBranchPublicId: v.optional(v.string()),
    title: v.string(),
  },
  returns: chatSummaryValidator,
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.workspaceId !== args.workspaceId) {
        throw new Error("Project not found in this workspace.");
      }
    }

    const publicId = createPublicId("chat", args.publicId);
    const rootBranchPublicId = createPublicId("branch", args.rootBranchPublicId);
    const title = requireText(args.title, "Chat title", convexConfig.domain.limits.chatTitleLength);
    const existingChat = await ctx.db
      .query("chats")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", publicId),
      )
      .unique();
    if (existingChat) {
      throw new Error("Chat public ID already exists in this workspace.");
    }
    const existingBranch = await ctx.db
      .query("chat_branches")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", rootBranchPublicId),
      )
      .unique();
    if (existingBranch) {
      throw new Error("Branch public ID already exists in this workspace.");
    }

    const now = Date.now();
    const chatId = await ctx.db.insert("chats", {
      publicId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      title,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
    const rootBranchId = await ctx.db.insert("chat_branches", {
      publicId: rootBranchPublicId,
      workspaceId: args.workspaceId,
      chatId,
      anchorType: "root",
      contextMessageIds: [],
      depth: 0,
      nextMessageOrdinal: 0,
      createdByUserId: user._id,
      createdAt: now,
    });
    await ctx.db.patch(chatId, { rootBranchId });

    return {
      id: chatId,
      publicId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      title,
      rootBranchId,
      createdAt: now,
      updatedAt: now,
    };
  },
});

export const getTree = query({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    chat: chatSummaryValidator,
    branches: v.array(branchNodeValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:read");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.workspaceId !== args.workspaceId) {
      throw new Error("Chat not found in this workspace.");
    }
    const limit = normalizeLimit(
      args.limit,
      convexConfig.domain.limits.defaultTreeSize,
      convexConfig.domain.limits.maxTreeSize,
    );
    const branches = await ctx.db
      .query("chat_branches")
      .withIndex("by_workspace_chat_created_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .order("asc")
      .take(limit + 1);

    return {
      chat: toChatSummary(chat),
      branches: branches.slice(0, limit).map((branch) => ({
        id: branch._id,
        publicId: branch.publicId,
        parentBranchId: branch.parentBranchId,
        anchorType: branch.anchorType,
        anchorSourceBranchId: branch.anchorSourceBranchId,
        anchorSourceMessageId: branch.anchorSourceMessageId,
        anchorSelection: branch.anchorSelection,
        anchorPrompt: branch.anchorPrompt,
        contextMessageIds: branch.contextMessageIds,
        contextPreview: branch.contextPreview,
        depth: branch.depth,
        createdAt: branch.createdAt,
      })),
      truncated: branches.length > limit,
    };
  },
});
