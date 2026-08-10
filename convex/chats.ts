/** Workspace-scoped chats and bounded branch-tree reads. */

import { v } from "convex/values";
import { sharedConfig } from "../lib/config";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { convexConfig } from "./config";
import {
  archiveResultValidator,
  autoTitleClaimValidator,
  branchNodeValidator,
  chatActivityAt,
  chatSummaryValidator,
  insertChat,
  isProviderId,
  mostRecentActiveChat,
  toBranchNode,
  toChatSummary,
} from "./lib/chatHelpers";
import { createPublicId, normalizeLimit, optionalText, requireText } from "./lib/domainValidation";
import { providerIdValidator } from "./lib/domainValidators";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

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
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:read");
    const limit = normalizeLimit(args.limit);

    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.workspaceId !== args.workspaceId) {
        throw new Error("Project not found in this workspace.");
      }
      const [currentChats, legacyChats] = await Promise.all([
        ctx.db
          .query("chats")
          .withIndex("by_workspace_project_archived_last_user_message_at", (index) =>
            index
              .eq("workspaceId", args.workspaceId)
              .eq("projectId", args.projectId)
              .eq("archivedAt", undefined)
              .gt("lastUserMessageAt", undefined),
          )
          .order("desc")
          .take(limit + 1),
        ctx.db
          .query("chats")
          .withIndex("by_workspace_project_archived_last_user_message_at", (index) =>
            index
              .eq("workspaceId", args.workspaceId)
              .eq("projectId", args.projectId)
              .eq("archivedAt", undefined)
              .eq("lastUserMessageAt", undefined),
          )
          .order("desc")
          .take(limit + 1),
      ]);
      const chats = [...currentChats, ...legacyChats].sort(
        (left, right) => chatActivityAt(right) - chatActivityAt(left),
      );
      return {
        items: await Promise.all(
          chats.slice(0, limit).map((chat) => toChatSummary(ctx, chat, user._id)),
        ),
        hasMore: chats.length > limit,
      };
    }

    const [currentChats, legacyChats] = await Promise.all([
      ctx.db
        .query("chats")
        .withIndex("by_workspace_archived_last_user_message_at", (index) =>
          index
            .eq("workspaceId", args.workspaceId)
            .eq("archivedAt", undefined)
            .gt("lastUserMessageAt", undefined),
        )
        .order("desc")
        .take(limit + 1),
      ctx.db
        .query("chats")
        .withIndex("by_workspace_archived_last_user_message_at", (index) =>
          index
            .eq("workspaceId", args.workspaceId)
            .eq("archivedAt", undefined)
            .eq("lastUserMessageAt", undefined),
        )
        .order("desc")
        .take(limit + 1),
    ]);
    const chats = [...currentChats, ...legacyChats].sort(
      (left, right) => chatActivityAt(right) - chatActivityAt(left),
    );
    return {
      items: await Promise.all(
        chats.slice(0, limit).map((chat) => toChatSummary(ctx, chat, user._id)),
      ),
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
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:read");
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", args.publicId),
      )
      .unique();
    return chat && chat.archivedAt === undefined ? toChatSummary(ctx, chat, user._id) : null;
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

export const rename = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatPublicId: v.string(),
    title: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chatPublicId = createPublicId("chat", args.chatPublicId);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", chatPublicId),
      )
      .unique();
    if (!chat || chat.archivedAt !== undefined) return false;
    const title = requireText(args.title, "Chat title", convexConfig.domain.limits.chatTitleLength);
    await ctx.db.patch(chat._id, {
      title,
      autoTitleStatus: "generated",
      autoTitleInputMessageId: undefined,
      autoTitleClaimToken: undefined,
      autoTitleClaimedAt: undefined,
      autoTitleProvider: undefined,
      autoTitleModel: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const archive = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatPublicId: v.string(),
    replacementTitle: v.string(),
  },
  returns: archiveResultValidator,
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chatPublicId = createPublicId("chat", args.chatPublicId);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", chatPublicId),
      )
      .unique();
    if (!chat) throw new Error("Chat not found in this workspace.");

    const archived = chat.archivedAt === undefined;
    if (archived) {
      const now = Date.now();
      await ctx.db.patch(chat._id, { archivedAt: now, updatedAt: now });
    }

    const nextChat = await mostRecentActiveChat(ctx, args.workspaceId);
    const nextSummary = nextChat
      ? await toChatSummary(ctx, nextChat, user._id)
      : await insertChat(ctx, {
          workspaceId: args.workspaceId,
          title: args.replacementTitle,
          autoTitle: true,
          createdByUserId: user._id,
        });

    return {
      archived,
      nextChatPublicId: nextSummary.publicId,
      nextRootBranchPublicId: nextSummary.rootBranchPublicId,
    };
  },
});

export const restore = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatPublicId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chatPublicId = createPublicId("chat", args.chatPublicId);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", chatPublicId),
      )
      .unique();
    if (!chat) throw new Error("Chat not found in this workspace.");
    if (chat.archivedAt === undefined) return true;
    await ctx.db.patch(chat._id, { archivedAt: undefined, updatedAt: Date.now() });
    return true;
  },
});

export const setPinned = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatPublicId: v.string(),
    pinned: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:personalize");
    const chatPublicId = createPublicId("chat", args.chatPublicId);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", chatPublicId),
      )
      .unique();
    if (!chat || chat.archivedAt !== undefined) return false;

    const current = await ctx.db
      .query("chat_user_states")
      .withIndex("by_workspace_user_chat", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("userId", user._id).eq("chatId", chat._id),
      )
      .unique();
    if (!args.pinned && !current) return true;
    if (args.pinned && current?.pinnedAt !== undefined) return true;
    if (!args.pinned && current?.pinnedAt === undefined) return true;

    const now = Date.now();
    if (current) {
      await ctx.db.patch(current._id, {
        pinnedAt: args.pinned ? now : undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("chat_user_states", {
        publicId: createPublicId("chatstate"),
        workspaceId: args.workspaceId,
        chatId: chat._id,
        userId: user._id,
        pinnedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    return true;
  },
});

export const markUnread = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatPublicId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:personalize");
    const chatPublicId = createPublicId("chat", args.chatPublicId);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", chatPublicId),
      )
      .unique();
    if (!chat || chat.archivedAt !== undefined) return false;

    const current = await ctx.db
      .query("chat_user_states")
      .withIndex("by_workspace_user_chat", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("userId", user._id).eq("chatId", chat._id),
      )
      .unique();
    if (!current) return true;
    if (current.lastReadMessageId === undefined && current.lastReadMessagePublicId === undefined) {
      return true;
    }
    await ctx.db.patch(current._id, {
      lastReadMessageId: undefined,
      lastReadMessagePublicId: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const markRead = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatPublicId: v.string(),
    messagePublicId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:personalize");
    const chatPublicId = createPublicId("chat", args.chatPublicId);
    const messagePublicId = createPublicId("message", args.messagePublicId);
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", chatPublicId),
      )
      .unique();
    if (!chat || chat.archivedAt !== undefined) return false;
    const message = await ctx.db
      .query("messages")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", messagePublicId),
      )
      .unique();
    if (
      !message ||
      message.chatId !== chat._id ||
      chat.latestCompletedMessageId !== message._id ||
      chat.latestCompletedMessagePublicId !== message.publicId
    ) {
      return false;
    }

    const current = await ctx.db
      .query("chat_user_states")
      .withIndex("by_workspace_user_chat", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("userId", user._id).eq("chatId", chat._id),
      )
      .unique();
    if (current?.lastReadMessageId === message._id) return true;
    const now = Date.now();
    if (current) {
      await ctx.db.patch(current._id, {
        lastReadMessageId: message._id,
        lastReadMessagePublicId: message.publicId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("chat_user_states", {
        publicId: createPublicId("chatstate"),
        workspaceId: args.workspaceId,
        chatId: chat._id,
        userId: user._id,
        lastReadMessageId: message._id,
        lastReadMessagePublicId: message.publicId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return true;
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
    const storedProvider = optionalText(
      chat.autoTitleProvider,
      "Auto-title provider",
      convexConfig.domain.limits.providerNameLength,
    );
    const provider = isProviderId(storedProvider) ? storedProvider : args.provider;
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
  const existing = await mostRecentActiveChat(ctx, input.workspaceId);
  if (existing) return toChatSummary(ctx, existing, input.createdByUserId);

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
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:read");
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
      chat: await toChatSummary(ctx, chat, user._id),
      branches: selectedBranches.map(toBranchNode),
      truncated: branches.length > limit,
    };
  },
});
