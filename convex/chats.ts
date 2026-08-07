/** Workspace-scoped chats and bounded branch-tree reads. */

import { v } from "convex/values";
import { sharedConfig } from "../lib/config";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { convexConfig } from "./config";
import { createPublicId, normalizeLimit, optionalText, requireText } from "./lib/domainValidation";
import {
  branchAnchorTypeValidator,
  branchSelectionValidator,
  providerIdValidator,
} from "./lib/domainValidators";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

const chatSummaryValidator = v.object({
  id: v.id("chats"),
  publicId: v.string(),
  workspaceId: v.id("workspaces"),
  projectId: v.optional(v.id("projects")),
  title: v.string(),
  autoTitleStatus: v.optional(
    v.union(v.literal("pending"), v.literal("generating"), v.literal("generated")),
  ),
  autoTitleReady: v.optional(v.boolean()),
  rootBranchId: v.id("chat_branches"),
  rootBranchPublicId: v.string(),
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

const autoTitleClaimValidator = v.object({
  inputMessageId: v.id("messages"),
  intent: v.string(),
  provider: v.string(),
  model: v.string(),
});

function toBranchNode(branch: Doc<"chat_branches">) {
  return {
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
  };
}

async function toChatSummary(ctx: QueryCtx | MutationCtx, chat: Doc<"chats">) {
  if (!chat.rootBranchId) {
    throw new Error("Chat is missing its root branch.");
  }
  let rootBranchPublicId = chat.rootBranchPublicId;
  if (!rootBranchPublicId) {
    const rootBranch = await ctx.db.get(chat.rootBranchId);
    if (
      !rootBranch ||
      rootBranch.workspaceId !== chat.workspaceId ||
      rootBranch.chatId !== chat._id
    ) {
      throw new Error("Chat root branch was not found.");
    }
    rootBranchPublicId = rootBranch.publicId;
  }
  return {
    id: chat._id,
    publicId: chat.publicId,
    workspaceId: chat.workspaceId,
    projectId: chat.projectId,
    title: chat.title,
    autoTitleStatus: chat.autoTitleStatus,
    autoTitleReady: chat.autoTitleInputMessageId !== undefined,
    rootBranchId: chat.rootBranchId,
    rootBranchPublicId,
    archivedAt: chat.archivedAt,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

async function insertChat(
  ctx: MutationCtx,
  input: {
    workspaceId: Id<"workspaces">;
    projectId?: Id<"projects">;
    publicId?: string;
    rootBranchPublicId?: string;
    title: string;
    autoTitle?: boolean;
    createdByUserId: Id<"users">;
  },
) {
  const publicId = createPublicId("chat", input.publicId);
  const rootBranchPublicId = createPublicId("branch", input.rootBranchPublicId);
  const title = requireText(input.title, "Chat title", convexConfig.domain.limits.chatTitleLength);
  const existingChat = await ctx.db
    .query("chats")
    .withIndex("by_workspace_public_id", (index) =>
      index.eq("workspaceId", input.workspaceId).eq("publicId", publicId),
    )
    .unique();
  if (existingChat) {
    throw new Error("Chat public ID already exists in this workspace.");
  }
  const existingBranch = await ctx.db
    .query("chat_branches")
    .withIndex("by_workspace_public_id", (index) =>
      index.eq("workspaceId", input.workspaceId).eq("publicId", rootBranchPublicId),
    )
    .unique();
  if (existingBranch) {
    throw new Error("Branch public ID already exists in this workspace.");
  }

  const now = Date.now();
  const chatId = await ctx.db.insert("chats", {
    publicId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    title,
    ...(input.autoTitle ? { autoTitleStatus: "pending" as const } : {}),
    rootBranchPublicId,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
  const rootBranchId = await ctx.db.insert("chat_branches", {
    publicId: rootBranchPublicId,
    workspaceId: input.workspaceId,
    chatId,
    anchorType: "root",
    contextMessageIds: [],
    depth: 0,
    nextMessageOrdinal: 0,
    createdByUserId: input.createdByUserId,
    createdAt: now,
  });
  await ctx.db.patch(chatId, { rootBranchId });

  return {
    id: chatId,
    publicId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    title,
    autoTitleStatus: input.autoTitle ? ("pending" as const) : undefined,
    rootBranchId,
    rootBranchPublicId,
    createdAt: now,
    updatedAt: now,
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
        items: await Promise.all(chats.slice(0, limit).map((chat) => toChatSummary(ctx, chat))),
        hasMore: chats.length > limit,
      };
    }

    const chats = await ctx.db
      .query("chats")
      .withIndex("by_workspace_updated_at", (index) => index.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(limit + 1);
    return {
      items: await Promise.all(chats.slice(0, limit).map((chat) => toChatSummary(ctx, chat))),
      hasMore: chats.length > limit,
    };
  },
});

export const getByPublicId = query({
  args: {
    workspaceId: v.id("workspaces"),
    publicId: v.string(),
  },
  returns: v.union(chatSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:read");
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", args.publicId),
      )
      .unique();
    return chat ? toChatSummary(ctx, chat) : null;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    publicId: v.optional(v.string()),
    rootBranchPublicId: v.optional(v.string()),
    title: v.string(),
    autoTitle: v.optional(v.boolean()),
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

    return insertChat(ctx, {
      ...args,
      createdByUserId: user._id,
    });
  },
});

export const claimAutoTitle = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    claimToken: v.string(),
    provider: v.optional(providerIdValidator),
    model: v.optional(v.string()),
  },
  returns: v.union(autoTitleClaimValidator, v.null()),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.workspaceId !== args.workspaceId) {
      throw new Error("Chat not found in this workspace.");
    }
    const claimToken = requireText(
      args.claimToken,
      "Auto-title claim token",
      convexConfig.domain.limits.publicIdLength,
    );
    const now = Date.now();
    const staleClaim =
      chat.autoTitleStatus === "generating" &&
      (chat.autoTitleClaimedAt === undefined ||
        chat.autoTitleClaimedAt <= now - convexConfig.domain.chatNaming.claimLeaseMs);
    if (chat.autoTitleStatus !== "pending" && !staleClaim) return null;
    let firstMessage = chat.autoTitleInputMessageId
      ? await ctx.db.get(chat.autoTitleInputMessageId)
      : null;
    if (
      !firstMessage ||
      firstMessage.workspaceId !== args.workspaceId ||
      firstMessage.chatId !== args.chatId ||
      firstMessage.role !== "user"
    ) {
      firstMessage = await ctx.db
        .query("messages")
        .withIndex("by_workspace_chat_created_at", (index) =>
          index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
        )
        .filter((queryBuilder) => queryBuilder.eq(queryBuilder.field("role"), "user"))
        .order("asc")
        .first();
    }
    if (!firstMessage) return null;
    const provider =
      chat.autoTitleProvider ??
      optionalText(
        args.provider,
        "Auto-title provider",
        convexConfig.domain.limits.providerNameLength,
      );
    const model =
      chat.autoTitleModel ??
      optionalText(args.model, "Auto-title model", convexConfig.domain.limits.modelNameLength);
    if (!provider || !model) return null;
    await ctx.db.patch(chat._id, {
      autoTitleStatus: "generating",
      autoTitleInputMessageId: firstMessage._id,
      autoTitleClaimToken: claimToken,
      autoTitleClaimedAt: now,
      autoTitleProvider: provider,
      autoTitleModel: model,
    });
    return {
      inputMessageId: firstMessage._id,
      intent: firstMessage.contentPreview,
      provider,
      model,
    };
  },
});

export const releaseAutoTitle = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    claimToken: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.workspaceId !== args.workspaceId) {
      throw new Error("Chat not found in this workspace.");
    }
    const claimToken = requireText(
      args.claimToken,
      "Auto-title claim token",
      convexConfig.domain.limits.publicIdLength,
    );
    if (chat.autoTitleStatus !== "generating" || chat.autoTitleClaimToken !== claimToken) {
      return false;
    }
    await ctx.db.patch(chat._id, {
      autoTitleStatus: "pending",
      autoTitleClaimToken: undefined,
      autoTitleClaimedAt: undefined,
      autoTitleProvider: undefined,
      autoTitleModel: undefined,
    });
    return true;
  },
});

export const completeAutoTitle = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    claimToken: v.string(),
    title: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.workspaceId !== args.workspaceId) {
      throw new Error("Chat not found in this workspace.");
    }
    const claimToken = requireText(
      args.claimToken,
      "Auto-title claim token",
      convexConfig.domain.limits.publicIdLength,
    );
    if (chat.autoTitleStatus !== "generating" || chat.autoTitleClaimToken !== claimToken) {
      return false;
    }
    const title = requireText(args.title, "Chat title", convexConfig.domain.limits.chatTitleLength);
    if (title.split(/\s+/u).length > sharedConfig.chatNaming.maxGeneratedWords) {
      throw new Error(
        `Chat title must contain at most ${sharedConfig.chatNaming.maxGeneratedWords} words.`,
      );
    }
    const updatedAt = Date.now();
    await ctx.db.patch(chat._id, {
      title,
      autoTitleStatus: "generated",
      autoTitleClaimToken: undefined,
      autoTitleClaimedAt: undefined,
      autoTitleProvider: undefined,
      autoTitleModel: undefined,
      updatedAt,
    });
    return true;
  },
});

async function ensureInitialChat(
  ctx: MutationCtx,
  input: {
    workspaceId: Id<"workspaces">;
    title: string;
    autoTitle?: boolean;
    createdByUserId: Id<"users">;
  },
) {
  const existing = await ctx.db
    .query("chats")
    .withIndex("by_workspace_updated_at", (index) => index.eq("workspaceId", input.workspaceId))
    .order("desc")
    .first();
  if (existing) return toChatSummary(ctx, existing);

  return insertChat(ctx, input);
}

export const ensureInitial = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    autoTitle: v.optional(v.boolean()),
  },
  returns: chatSummaryValidator,
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    return ensureInitialChat(ctx, {
      ...args,
      createdByUserId: user._id,
    });
  },
});

export const getTree = query({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    limit: v.optional(v.number()),
    targetBranchPublicId: v.optional(v.string()),
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
    const selectedBranches = branches.slice(0, limit);

    if (args.targetBranchPublicId) {
      const targetBranchPublicId = requireText(
        args.targetBranchPublicId,
        "Target branch public ID",
        convexConfig.domain.limits.publicIdLength,
      );
      const selectedIds = new Set(selectedBranches.map((branch) => String(branch._id)));
      let cursor = await ctx.db
        .query("chat_branches")
        .withIndex("by_workspace_public_id", (index) =>
          index.eq("workspaceId", args.workspaceId).eq("publicId", targetBranchPublicId),
        )
        .unique();
      const targetLineage: Doc<"chat_branches">[] = [];

      while (
        cursor &&
        cursor.workspaceId === args.workspaceId &&
        cursor.chatId === args.chatId &&
        !selectedIds.has(String(cursor._id)) &&
        targetLineage.length <= convexConfig.domain.limits.maxBranchDepth
      ) {
        targetLineage.push(cursor);
        selectedIds.add(String(cursor._id));
        cursor = cursor.parentBranchId ? await ctx.db.get(cursor.parentBranchId) : null;
      }
      // Preserve the complete URL-target lineage even when that makes this response exceed limit.
      selectedBranches.push(...targetLineage.reverse());
    }

    return {
      chat: await toChatSummary(ctx, chat),
      branches: selectedBranches.map(toBranchNode),
      truncated: branches.length > limit,
    };
  },
});
