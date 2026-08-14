/** Shared validators and persistence helpers for workspace chats. */

import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { convexConfig } from "../config";
import { createPublicId, requireText } from "./domainValidation";
import {
  branchAnchorTypeValidator,
  branchSelectionValidator,
  type ProviderId,
  providerIds,
  providerIdValidator,
} from "./domainValidators";

export const chatSummaryValidator = v.object({
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
  latestCompletedMessagePublicId: v.optional(v.string()),
  lastUserMessageAt: v.number(),
  isUnread: v.boolean(),
  isPinned: v.boolean(),
  pinnedAt: v.optional(v.number()),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const branchNodeValidator = v.object({
  id: v.id("chat_branches"),
  publicId: v.string(),
  activeRunId: v.optional(v.id("agent_runs")),
  activeRunLeaseExpiresAt: v.optional(v.number()),
  parentBranchId: v.optional(v.id("chat_branches")),
  anchorType: branchAnchorTypeValidator,
  anchorSourceBranchId: v.optional(v.id("chat_branches")),
  anchorSourceMessageId: v.optional(v.id("messages")),
  anchorSelection: v.optional(branchSelectionValidator),
  anchorPrompt: v.optional(v.string()),
  title: v.optional(v.string()),
  isUnread: v.boolean(),
  contextMessageIds: v.array(v.id("messages")),
  contextPreview: v.optional(v.string()),
  depth: v.number(),
  createdAt: v.number(),
});

export const autoTitleClaimValidator = v.object({
  inputMessageId: v.id("messages"),
  intent: v.string(),
  provider: providerIdValidator,
  model: v.string(),
});

export const archiveResultValidator = v.object({
  archived: v.boolean(),
  nextChatPublicId: v.string(),
  nextRootBranchPublicId: v.string(),
});

export function isProviderId(value: string | undefined): value is ProviderId {
  return providerIds.includes(value as ProviderId);
}

export function toBranchNode(branch: Doc<"chat_branches">, unreadBranchPublicIds?: Set<string>) {
  return {
    id: branch._id,
    publicId: branch.publicId,
    activeRunId: branch.activeRunId,
    activeRunLeaseExpiresAt: branch.activeRunLeaseExpiresAt,
    parentBranchId: branch.parentBranchId,
    anchorType: branch.anchorType,
    anchorSourceBranchId: branch.anchorSourceBranchId,
    anchorSourceMessageId: branch.anchorSourceMessageId,
    anchorSelection: branch.anchorSelection,
    anchorPrompt: branch.anchorPrompt,
    title: branch.title,
    isUnread: unreadBranchPublicIds?.has(branch.publicId) ?? false,
    contextMessageIds: branch.contextMessageIds,
    contextPreview: branch.contextPreview,
    depth: branch.depth,
    createdAt: branch.createdAt,
  };
}

export function chatActivityAt(chat: Doc<"chats">): number {
  return chat.lastUserMessageAt ?? chat.createdAt;
}

export async function mostRecentActiveChat(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"chats"> | null> {
  const [currentChat, legacyChat] = await Promise.all([
    ctx.db
      .query("chats")
      .withIndex("by_workspace_archived_last_user_message_at", (index) =>
        index
          .eq("workspaceId", workspaceId)
          .eq("archivedAt", undefined)
          .gt("lastUserMessageAt", undefined),
      )
      .order("desc")
      .first(),
    ctx.db
      .query("chats")
      .withIndex("by_workspace_archived_last_user_message_at", (index) =>
        index
          .eq("workspaceId", workspaceId)
          .eq("archivedAt", undefined)
          .eq("lastUserMessageAt", undefined),
      )
      .order("desc")
      .first(),
  ]);
  if (!currentChat) return legacyChat;
  if (!legacyChat) return currentChat;
  return chatActivityAt(currentChat) >= chatActivityAt(legacyChat) ? currentChat : legacyChat;
}

export async function toChatSummary(
  ctx: QueryCtx | MutationCtx,
  chat: Doc<"chats">,
  userId: Id<"users">,
) {
  if (!chat.rootBranchId) throw new Error("Chat is missing its root branch.");
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
  const userState = await ctx.db
    .query("chat_user_states")
    .withIndex("by_workspace_user_chat", (index) =>
      index.eq("workspaceId", chat.workspaceId).eq("userId", userId).eq("chatId", chat._id),
    )
    .unique();
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
    latestCompletedMessagePublicId: chat.latestCompletedMessagePublicId,
    lastUserMessageAt: chat.lastUserMessageAt ?? chat.createdAt,
    isUnread: Boolean(
      chat.latestCompletedMessageId &&
        userState?.lastReadMessageId !== chat.latestCompletedMessageId,
    ),
    isPinned: userState?.pinnedAt !== undefined,
    pinnedAt: userState?.pinnedAt,
    archivedAt: chat.archivedAt,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

export async function insertChat(
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
  if (existingChat) throw new Error("Chat public ID already exists in this workspace.");
  const existingBranch = await ctx.db
    .query("chat_branches")
    .withIndex("by_workspace_public_id", (index) =>
      index.eq("workspaceId", input.workspaceId).eq("publicId", rootBranchPublicId),
    )
    .unique();
  if (existingBranch) throw new Error("Branch public ID already exists in this workspace.");

  const now = Date.now();
  const chatId = await ctx.db.insert("chats", {
    publicId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    title,
    ...(input.autoTitle ? { autoTitleStatus: "pending" as const } : {}),
    rootBranchPublicId,
    lastUserMessageAt: now,
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
    runLeaseVersion: 1,
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
    lastUserMessageAt: now,
    isUnread: false,
    isPinned: false,
    createdAt: now,
    updatedAt: now,
  };
}
