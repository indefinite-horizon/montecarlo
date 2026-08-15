/** Transactional message-history truncation for edit and retry flows. */

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { convexConfig } from "./config";
import { createPublicId } from "./lib/domainValidation";
import { selectLatestStandaloneMessage } from "./lib/messageOrder";
import { hasActiveRunOnBranch } from "./lib/runLeases";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

const truncateResultValidator = v.object({
  branchId: v.id("chat_branches"),
  branchPublicId: v.string(),
  removedBranchIds: v.array(v.id("chat_branches")),
  removedMessagePublicIds: v.array(v.string()),
});

const deleteBranchResultValidator = v.object({
  parentBranchId: v.id("chat_branches"),
  parentBranchPublicId: v.string(),
  removedBranchIds: v.array(v.id("chat_branches")),
});

export const deleteBranchSubtree = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    branchId: v.id("chat_branches"),
  },
  returns: deleteBranchResultValidator,
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chat = await ctx.db.get(args.chatId);
    const target = await ctx.db.get(args.branchId);
    if (
      !chat ||
      chat.workspaceId !== args.workspaceId ||
      !target ||
      target.workspaceId !== args.workspaceId ||
      target.chatId !== args.chatId ||
      !target.parentBranchId
    ) {
      throw new Error("Child branch not found in this chat.");
    }
    const parent = await ctx.db.get(target.parentBranchId);
    if (!parent || parent.chatId !== chat._id) throw new Error("Parent branch not found.");

    const branchLimit = convexConfig.domain.limits.maxTreeSize;
    const branches = await ctx.db
      .query("chat_branches")
      .withIndex("by_workspace_chat_created_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .take(branchLimit + 1);
    if (branches.length > branchLimit) throw new Error("Chat branch limit exceeded.");

    const removedBranchIds = new Set<Id<"chat_branches">>([target._id]);
    for (const branch of [...branches].sort((left, right) => left.depth - right.depth)) {
      if (branch.parentBranchId && removedBranchIds.has(branch.parentBranchId)) {
        removedBranchIds.add(branch._id);
      }
    }
    const now = Date.now();
    for (const branch of branches) {
      if (removedBranchIds.has(branch._id) && (await hasActiveRunOnBranch(ctx, branch, now))) {
        throw new Error("Wait for the affected responses to finish before deleting this branch.");
      }
    }

    const messageLimit = convexConfig.domain.limits.maxTruncateMessageCount;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_workspace_chat_created_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .take(messageLimit + 1);
    if (messages.length > messageLimit) throw new Error("Message deletion limit exceeded.");
    const removedMessages = new Set(
      messages
        .filter((message) => removedBranchIds.has(message.branchId))
        .map((message) => message._id),
    );

    const runLimit = convexConfig.domain.limits.maxRunHistorySize;
    const runs = await ctx.db
      .query("agent_runs")
      .withIndex("by_workspace_chat_updated_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .take(runLimit + 1);
    if (runs.length > runLimit) throw new Error("Chat run history limit exceeded.");
    const removedRuns = runs.filter((run) => removedBranchIds.has(run.branchId));
    if (removedRuns.some((run) => run.status === "running")) {
      throw new Error("Wait for the affected responses to finish before deleting this branch.");
    }

    for (const run of removedRuns) await ctx.db.delete(run._id);
    for (const message of messages) {
      if (removedMessages.has(message._id)) await ctx.db.delete(message._id);
    }
    for (const branch of [...branches].sort((left, right) => right.depth - left.depth)) {
      if (removedBranchIds.has(branch._id)) await ctx.db.delete(branch._id);
    }

    const remainingMessages = messages.filter((message) => !removedMessages.has(message._id));
    const latestUserMessage = remainingMessages
      .filter((message) => message.role === "user")
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    const remainingRuns = runs
      .filter((run) => !removedBranchIds.has(run.branchId) && run.status === "succeeded")
      .sort((left, right) => (right.completedAt ?? 0) - (left.completedAt ?? 0));
    const latestRun = remainingRuns[0];
    const latestRunMessage = latestRun?.outputMessageId
      ? remainingMessages.find((message) => message._id === latestRun.outputMessageId)
      : undefined;
    const latestStandalone = remainingMessages
      .filter((message) => message.role === "user" || message.role === "system")
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    const latestCompletedMessage =
      (latestRun?.completedAt ?? 0) >= (latestStandalone?.createdAt ?? 0)
        ? latestRunMessage
        : latestStandalone;
    await ctx.db.patch(chat._id, {
      latestCompletedMessageId: latestCompletedMessage?._id,
      latestCompletedMessagePublicId: latestCompletedMessage?.publicId,
      latestCompletedAt:
        latestCompletedMessage === latestRunMessage
          ? latestRun?.completedAt
          : latestStandalone?.createdAt,
      lastUserMessageAt: latestUserMessage?.createdAt ?? chat.createdAt,
      ...(chat.autoTitleInputMessageId && removedMessages.has(chat.autoTitleInputMessageId)
        ? { autoTitleInputMessageId: undefined }
        : {}),
      updatedAt: now,
    });

    const removedPublicIds = new Set(
      branches
        .filter((branch) => removedBranchIds.has(branch._id))
        .map((branch) => branch.publicId),
    );
    const userStates = await ctx.db
      .query("chat_user_states")
      .withIndex("by_workspace_chat", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .take(convexConfig.domain.limits.maxChatUserStateCount + 1);
    for (const state of userStates) {
      const unreadBranchPublicIds = state.unreadBranchPublicIds?.filter(
        (publicId) => !removedPublicIds.has(publicId),
      );
      await ctx.db.patch(state._id, {
        unreadBranchPublicIds,
        ...(state.lastReadMessageId && removedMessages.has(state.lastReadMessageId)
          ? { lastReadMessageId: undefined, lastReadMessagePublicId: undefined }
          : {}),
        updatedAt: now,
      });
    }

    return {
      parentBranchId: parent._id,
      parentBranchPublicId: parent.publicId,
      removedBranchIds: [...removedBranchIds],
    };
  },
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

    const messageLimit = convexConfig.domain.limits.maxTruncateMessageCount;
    const targetTail = await ctx.db
      .query("messages")
      .withIndex("by_workspace_branch_ordinal", (index) =>
        index
          .eq("workspaceId", args.workspaceId)
          .eq("branchId", target.branchId)
          .gte("ordinal", target.ordinal),
      )
      .take(messageLimit + 1);
    if (targetTail.length > messageLimit) {
      throw new Error("Message truncation limit exceeded.");
    }
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
      const remainingMessageLimit = messageLimit - removedMessages.size;
      const branchMessages = await ctx.db
        .query("messages")
        .withIndex("by_workspace_branch_ordinal", (index) =>
          index.eq("workspaceId", args.workspaceId).eq("branchId", branch._id),
        )
        .take(remainingMessageLimit + 1);
      if (branchMessages.length > remainingMessageLimit) {
        throw new Error("Message truncation limit exceeded.");
      }
      for (const message of branchMessages) removedMessages.set(message._id, message);
    }

    const affectedBranchIds = new Set<Id<"chat_branches">>([targetBranch._id, ...removedBranchIds]);
    const now = Date.now();
    for (const branch of branches) {
      if (affectedBranchIds.has(branch._id) && (await hasActiveRunOnBranch(ctx, branch, now))) {
        throw new Error("Wait for the affected responses to finish before retrying.");
      }
    }
    if (
      !branches.some((branch) => branch._id === targetBranch._id) &&
      (await hasActiveRunOnBranch(ctx, targetBranch, now))
    ) {
      throw new Error("Wait for the affected responses to finish before retrying.");
    }

    const runLimit = convexConfig.domain.limits.maxRunHistorySize;
    const allRuns = await ctx.db
      .query("agent_runs")
      .withIndex("by_workspace_chat_updated_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .take(runLimit + 1);
    if (allRuns.length > runLimit) {
      throw new Error("Chat run history limit exceeded.");
    }
    if (allRuns.some((run) => run.branchId === targetBranch._id && run.status === "running")) {
      throw new Error("Wait for the current response to finish before retrying.");
    }
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
    const latestUserMessage = await ctx.db
      .query("messages")
      .withIndex("by_workspace_chat_role_created_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId).eq("role", "user"),
      )
      .order("desc")
      .first();
    const latestSystemMessage = await ctx.db
      .query("messages")
      .withIndex("by_workspace_chat_role_created_at", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId).eq("role", "system"),
      )
      .order("desc")
      .first();
    const latestStandaloneMessage = selectLatestStandaloneMessage(
      latestUserMessage,
      latestSystemMessage,
    );
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

    const userStateLimit = convexConfig.domain.limits.maxChatUserStateCount;
    const userStates = await ctx.db
      .query("chat_user_states")
      .withIndex("by_workspace_chat", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("chatId", args.chatId),
      )
      .take(userStateLimit + 1);
    if (userStates.length > userStateLimit) {
      throw new Error("Chat participant limit exceeded.");
    }
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
