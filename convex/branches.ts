/** Creates immutable chat branches with source and selection anchors. */

import { v } from "convex/values";
import { sharedConfig } from "../lib/config";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation } from "./_generated/server";
import { convexConfig } from "./config";
import {
  createPublicId,
  optionalText,
  requireNonNegativeInteger,
  requireText,
  selectionMatchesStoredMessage,
} from "./lib/domainValidation";
import { branchAnchorTypeValidator, branchSelectionValidator } from "./lib/domainValidators";
import { hasActiveRunOnBranch } from "./lib/runLeases";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

const branchNodeValidator = v.object({
  id: v.id("chat_branches"),
  publicId: v.string(),
  workspaceId: v.id("workspaces"),
  chatId: v.id("chats"),
  parentBranchId: v.id("chat_branches"),
  anchorType: branchAnchorTypeValidator,
  anchorSourceBranchId: v.id("chat_branches"),
  anchorSourceMessageId: v.optional(v.id("messages")),
  anchorSelection: v.optional(branchSelectionValidator),
  anchorPrompt: v.optional(v.string()),
  title: v.string(),
  isUnread: v.boolean(),
  contextMessageIds: v.array(v.id("messages")),
  contextPreview: v.optional(v.string()),
  depth: v.number(),
  createdAt: v.number(),
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    parentBranchId: v.id("chat_branches"),
    publicId: v.optional(v.string()),
    sourceMessageId: v.optional(v.id("messages")),
    selection: v.optional(branchSelectionValidator),
    prompt: v.optional(v.string()),
  },
  returns: branchNodeValidator,
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.workspaceId !== args.workspaceId) {
      throw new Error("Chat not found in this workspace.");
    }
    const parent = await ctx.db.get(args.parentBranchId);
    if (!parent || parent.workspaceId !== args.workspaceId || parent.chatId !== args.chatId) {
      throw new Error("Parent branch not found in this chat.");
    }
    if (await hasActiveRunOnBranch(ctx, parent, Date.now())) {
      throw new Error("Wait for this branch's response to finish before branching.");
    }
    if (parent.depth >= convexConfig.domain.limits.maxBranchDepth) {
      throw new Error("Maximum branch depth reached.");
    }

    const prompt = optionalText(
      args.prompt,
      "Branch prompt",
      convexConfig.domain.limits.branchPromptLength,
    );
    if (!args.selection && !prompt) {
      throw new Error("A prompt is required when branching without a selection.");
    }

    let selection: { start: number; end: number; quote: string; displayText?: string } | undefined;
    if (args.selection) {
      const start = requireNonNegativeInteger(args.selection.start, "Selection start");
      const end = requireNonNegativeInteger(args.selection.end, "Selection end");
      if (end <= start) {
        throw new Error("Selection end must be greater than selection start.");
      }
      if (!args.sourceMessageId) {
        throw new Error("A selection must identify its source message.");
      }
      selection = {
        start,
        end,
        quote: requireText(
          args.selection.quote,
          "Selection quote",
          convexConfig.domain.limits.selectionQuoteLength,
        ),
        displayText: optionalText(
          args.selection.displayText,
          "Selection display text",
          convexConfig.domain.limits.selectionQuoteLength,
        ),
      };
    }

    const recentParentMessages = await ctx.db
      .query("messages")
      .withIndex("by_workspace_branch_ordinal", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("branchId", args.parentBranchId),
      )
      .order("desc")
      .take(convexConfig.domain.limits.maxBranchContextMessages);

    let sourceMessage: Doc<"messages"> | null = null;
    if (args.sourceMessageId) {
      sourceMessage = await ctx.db.get(args.sourceMessageId);
      if (
        !sourceMessage ||
        sourceMessage.workspaceId !== args.workspaceId ||
        sourceMessage.chatId !== args.chatId
      ) {
        throw new Error("Source message not found in this chat.");
      }
      const lineageBranchIds = new Set<string>();
      let lineageBranch: Doc<"chat_branches"> | null = parent;
      while (lineageBranch) {
        lineageBranchIds.add(String(lineageBranch._id));
        lineageBranch = lineageBranch.parentBranchId
          ? await ctx.db.get(lineageBranch.parentBranchId)
          : null;
      }
      if (!lineageBranchIds.has(String(sourceMessage.branchId))) {
        throw new Error("Source message is not part of the parent branch lineage.");
      }
      if (selection && !selectionMatchesStoredMessage(selection, sourceMessage)) {
        throw new Error("Selection does not match the stored source content.");
      }
    }
    if (!sourceMessage) {
      sourceMessage = recentParentMessages[0] ?? null;
    }

    const publicId = createPublicId("branch", args.publicId);
    const existing = await ctx.db
      .query("chat_branches")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", publicId),
      )
      .unique();
    if (existing) {
      throw new Error("Branch public ID already exists in this workspace.");
    }

    const anchorType: "selection" | "message" | "prompt" = selection
      ? "selection"
      : args.sourceMessageId
        ? "message"
        : "prompt";
    const inheritedAndRecentIds = [
      ...parent.contextMessageIds,
      ...[...recentParentMessages].reverse().map((message) => message._id),
      ...(sourceMessage ? [sourceMessage._id] : []),
    ];
    const contextMessageIds = [...new Set(inheritedAndRecentIds)].slice(
      -convexConfig.domain.limits.maxBranchContextMessages,
    );
    const recentContextPreview = [...recentParentMessages]
      .reverse()
      .slice(-4)
      .map((message) => message.contentPreview)
      .join("\n\n");
    const previewSource =
      selection?.displayText ??
      selection?.quote ??
      (recentContextPreview || sourceMessage?.contentPreview);
    const contextPreview = previewSource?.slice(0, convexConfig.domain.limits.contentPreviewLength);
    const title = requireText(
      (selection?.displayText ?? selection?.quote ?? prompt ?? "New branch").slice(
        0,
        convexConfig.domain.limits.chatTitleLength,
      ),
      "Branch title",
      convexConfig.domain.limits.chatTitleLength,
    );
    const now = Date.now();
    const branchId = await ctx.db.insert("chat_branches", {
      publicId,
      workspaceId: args.workspaceId,
      chatId: args.chatId,
      parentBranchId: args.parentBranchId,
      anchorType,
      anchorSourceBranchId: args.parentBranchId,
      anchorSourceMessageId: sourceMessage?._id,
      anchorSelection: selection,
      anchorPrompt: prompt,
      title,
      contextMessageIds,
      contextPreview,
      depth: parent.depth + 1,
      nextMessageOrdinal: 0,
      runLeaseVersion: 1,
      createdByUserId: user._id,
      createdAt: now,
    });
    await ctx.db.patch(args.chatId, { updatedAt: now });

    return {
      id: branchId,
      publicId,
      workspaceId: args.workspaceId,
      chatId: args.chatId,
      parentBranchId: args.parentBranchId,
      anchorType,
      anchorSourceBranchId: args.parentBranchId,
      anchorSourceMessageId: sourceMessage?._id,
      anchorSelection: selection,
      anchorPrompt: prompt,
      title,
      isUnread: false,
      contextMessageIds,
      contextPreview,
      depth: parent.depth + 1,
      createdAt: now,
    };
  },
});

export const completeAutoTitle = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    branchId: v.id("chat_branches"),
    title: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.workspaceId !== args.workspaceId || !branch.parentBranchId) {
      throw new Error("Child branch not found in this workspace.");
    }
    const title = requireText(
      args.title,
      "Branch title",
      convexConfig.domain.limits.chatTitleLength,
    );
    if (title.split(/\s+/u).length > sharedConfig.chatNaming.maxGeneratedWords) {
      throw new Error(
        `Branch title must contain at most ${sharedConfig.chatNaming.maxGeneratedWords} words.`,
      );
    }
    await ctx.db.patch(branch._id, { title });
    return true;
  },
});

export const rename = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    branchId: v.id("chat_branches"),
    title: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.workspaceId !== args.workspaceId || !branch.parentBranchId) return false;
    const title = requireText(
      args.title,
      "Branch title",
      convexConfig.domain.limits.chatTitleLength,
    );
    await ctx.db.patch(branch._id, { title });
    return true;
  },
});

async function updateUnreadBranch(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  branchId: Id<"chat_branches">,
  unread: boolean,
) {
  const { user } = await requireWorkspacePermission(ctx, workspaceId, "content:personalize");
  const branch = await ctx.db.get(branchId);
  if (!branch || branch.workspaceId !== workspaceId) return false;
  const current = await ctx.db
    .query("chat_user_states")
    .withIndex("by_workspace_user_chat", (index) =>
      index.eq("workspaceId", workspaceId).eq("userId", user._id).eq("chatId", branch.chatId),
    )
    .unique();
  const ids = new Set(current?.unreadBranchPublicIds ?? []);
  if (unread) ids.add(branch.publicId);
  else ids.delete(branch.publicId);
  const now = Date.now();
  const chat = await ctx.db.get(branch.chatId);
  const latestCompletedMessage = chat?.latestCompletedMessageId
    ? await ctx.db.get(chat.latestCompletedMessageId)
    : null;
  const marksLatestRead = !unread && latestCompletedMessage?.branchId === branch._id;
  if (current) {
    await ctx.db.patch(current._id, {
      unreadBranchPublicIds: [...ids],
      ...(unread
        ? { lastReadMessageId: undefined, lastReadMessagePublicId: undefined }
        : marksLatestRead
          ? {
              lastReadMessageId: latestCompletedMessage._id,
              lastReadMessagePublicId: latestCompletedMessage.publicId,
            }
          : {}),
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("chat_user_states", {
      publicId: createPublicId("chatstate"),
      workspaceId,
      chatId: branch.chatId,
      userId: user._id,
      unreadBranchPublicIds: [...ids],
      ...(marksLatestRead
        ? {
            lastReadMessageId: latestCompletedMessage._id,
            lastReadMessagePublicId: latestCompletedMessage.publicId,
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  return true;
}

export const markUnread = mutation({
  args: { workspaceId: v.id("workspaces"), branchId: v.id("chat_branches") },
  returns: v.boolean(),
  handler: (ctx, args) => updateUnreadBranch(ctx, args.workspaceId, args.branchId, true),
});

export const markRead = mutation({
  args: { workspaceId: v.id("workspaces"), branchId: v.id("chat_branches") },
  returns: v.boolean(),
  handler: (ctx, args) => updateUnreadBranch(ctx, args.workspaceId, args.branchId, false),
});
