/** Transactional message-history truncation for edit and retry flows. */

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { convexConfig } from "./config";
import { createPublicId } from "./lib/domainValidation";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

const truncateResultValidator = v.object({
  branchId: v.id("chat_branches"),
  branchPublicId: v.string(),
  removedBranchIds: v.array(v.id("chat_branches")),
  removedMessagePublicIds: v.array(v.string()),
});

export const truncateFromUserMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    messagePublicId: v.string(),
  },
  returns: truncateResultValidator,
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    await requireWorkspacePermission(ctx, args.workspaceId, "runs:execute");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.workspaceId !== args.workspaceId) {
      throw new Error("Chat not found in this workspace.");
    }
    const messagePublicId = createPublicId("message", args.messagePublicId);
    const target = await ctx.db
      .query("messages")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", messagePublicId),
      )
      .unique();
    if (!target || target.chatId !== args.chatId || target.role !== "user") {
      throw new Error("User message not found in this chat.");
    }
    const targetBranch = await ctx.db.get(target.branchId);
    if (!targetBranch || targetBranch.chatId !== args.chatId) {
      throw new Error("Message branch not found in this chat.");
    }

    const branchLimit = convexConfig.domain.limits.maxTreeSize;
    const branches = await ctx.db
      .query("chat_branches")
      .withIndex("by_workspace_chat_created_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .take(branchLimit + 1);
    if (branches.length > branchLimit) {
      throw new Error("Chat branch limit exceeded.");
    }

    const targetTail = await ctx.db
      .query("messages")
      .withIndex("by_workspace_branch_ordinal", (index) =>
        index
          .eq("workspaceId", args.workspaceId)
          .eq("branchId", target.branchId)
          .gte("ordinal", target.ordinal),
      )
      .collect();
    const removedMessages = new Map<Id<"messages">, Doc<"messages">>(
      targetTail.map((message) => [message._id, message]),
    );
    const removedBranchIds = new Set<Id<"chat_branches">>();

    for (const branch of [...branches].sort((left, right) => left.depth - right.depth)) {
      if (branch._id === target.branchId) continue;
      const dependsOnRemovedHistory =
        (branch.parentBranchId !== undefined && removedBranchIds.has(branch.parentBranchId)) ||
        (branch.anchorSourceMessageId !== undefined &&
          removedMessages.has(branch.anchorSourceMessageId)) ||
        branch.contextMessageIds.some((messageId) => removedMessages.has(messageId));
      if (!dependsOnRemovedHistory) continue;
      removedBranchIds.add(branch._id);
      const branchMessages = await ctx.db
        .query("messages")
        .withIndex("by_workspace_branch_ordinal", (index) =>
          index.eq("workspaceId", args.workspaceId).eq("branchId", branch._id),
        )
        .collect();
      for (const message of branchMessages) removedMessages.set(message._id, message);
    }

    const allRuns = await ctx.db
      .query("agent_runs")
      .withIndex("by_workspace_chat_updated_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .collect();
    const runsToDelete = allRuns.filter(
      (run) =>
        removedBranchIds.has(run.branchId) ||
        (run.inputMessageId !== undefined && removedMessages.has(run.inputMessageId)) ||
        (run.outputMessageId !== undefined && removedMessages.has(run.outputMessageId)),
    );
    if (runsToDelete.some((run) => run.status === "running")) {
      throw new Error("Wait for the current response to finish before retrying.");
    }

    for (const run of runsToDelete) await ctx.db.delete(run._id);
    for (const message of removedMessages.values()) await ctx.db.delete(message._id);
    for (const branch of [...branches].sort((left, right) => right.depth - left.depth)) {
      if (removedBranchIds.has(branch._id)) await ctx.db.delete(branch._id);
    }
    await ctx.db.patch(targetBranch._id, { nextMessageOrdinal: target.ordinal });

    const deletedRunIds = new Set(runsToDelete.map((run) => run._id));
    const remainingRuns = allRuns.filter(
      (run) =>
        !deletedRunIds.has(run._id) &&
        run.status === "succeeded" &&
        run.outputMessageId !== undefined &&
        !removedMessages.has(run.outputMessageId),
    );
    const latestRun = remainingRuns.sort(
      (left, right) => (right.completedAt ?? 0) - (left.completedAt ?? 0),
    )[0];
    const latestMessage = latestRun?.outputMessageId
      ? await ctx.db.get(latestRun.outputMessageId)
      : null;
    const latestStandaloneMessage = await ctx.db
      .query("messages")
      .withIndex("by_workspace_chat_created_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .filter((query) =>
        query.or(query.eq(query.field("role"), "user"), query.eq(query.field("role"), "system")),
      )
      .order("desc")
      .first();
    const latestUserMessage = await ctx.db
      .query("messages")
      .withIndex("by_workspace_chat_created_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .filter((query) => query.eq(query.field("role"), "user"))
      .order("desc")
      .first();
    const now = Date.now();
    const latestRunAt = latestRun?.completedAt ?? 0;
    const latestStandaloneAt = latestStandaloneMessage?.createdAt ?? 0;
    const latestCompletedMessage =
      latestRunAt >= latestStandaloneAt ? latestMessage : latestStandaloneMessage;
    const latestCompletedAt = Math.max(latestRunAt, latestStandaloneAt) || undefined;
    await ctx.db.patch(chat._id, {
      latestCompletedMessageId: latestCompletedMessage?._id,
      latestCompletedMessagePublicId: latestCompletedMessage?.publicId,
      latestCompletedAt,
      lastUserMessageAt: latestUserMessage?.createdAt ?? chat.createdAt,
      ...(chat.autoTitleInputMessageId && removedMessages.has(chat.autoTitleInputMessageId)
        ? { autoTitleInputMessageId: undefined }
        : {}),
      updatedAt: now,
    });

    const userStates = await ctx.db
      .query("chat_user_states")
      .withIndex("by_workspace_chat", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .collect();
    for (const state of userStates) {
      if (state.lastReadMessageId && removedMessages.has(state.lastReadMessageId)) {
        await ctx.db.patch(state._id, {
          // The replacement latest message may live on another branch this user never viewed.
          // Clearing the deleted receipt preserves unread state until visibility is observed again.
          lastReadMessageId: undefined,
          lastReadMessagePublicId: undefined,
          updatedAt: now,
        });
      }
    }

    return {
      branchId: targetBranch._id,
      branchPublicId: targetBranch.publicId,
      removedBranchIds: [...removedBranchIds],
      removedMessagePublicIds: [...removedMessages.values()].map((message) => message.publicId),
    };
  },
});
