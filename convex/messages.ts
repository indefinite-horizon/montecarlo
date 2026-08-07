/** Message envelopes backed by external blob content references. */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { convexConfig } from "./config";
import {
  createPublicId,
  normalizeLimit,
  requireNonNegativeInteger,
  requireText,
} from "./lib/domainValidation";
import { blobBackendValidator, messageRoleValidator } from "./lib/domainValidators";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

const messageSummaryValidator = v.object({
  id: v.id("messages"),
  publicId: v.string(),
  workspaceId: v.id("workspaces"),
  chatId: v.id("chats"),
  branchId: v.id("chat_branches"),
  ordinal: v.number(),
  role: messageRoleValidator,
  contentRef: v.string(),
  objectKey: v.string(),
  backend: blobBackendValidator,
  envelopeVersion: v.number(),
  contentPreview: v.string(),
  contentType: v.string(),
  byteLength: v.number(),
  sha256: v.string(),
  replyToMessageId: v.optional(v.id("messages")),
  runId: v.optional(v.id("agent_runs")),
  createdAt: v.number(),
});

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    branchId: v.id("chat_branches"),
    beforeOrdinal: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(messageSummaryValidator),
    nextBeforeOrdinal: v.union(v.number(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:read");
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.workspaceId !== args.workspaceId) {
      throw new Error("Branch not found in this workspace.");
    }
    const limit = normalizeLimit(args.limit);
    const beforeOrdinal =
      args.beforeOrdinal === undefined
        ? undefined
        : requireNonNegativeInteger(args.beforeOrdinal, "Before ordinal");
    const messages =
      beforeOrdinal === undefined
        ? await ctx.db
            .query("messages")
            .withIndex("by_workspace_branch_ordinal", (index) =>
              index.eq("workspaceId", args.workspaceId).eq("branchId", args.branchId),
            )
            .order("desc")
            .take(limit + 1)
        : await ctx.db
            .query("messages")
            .withIndex("by_workspace_branch_ordinal", (index) =>
              index
                .eq("workspaceId", args.workspaceId)
                .eq("branchId", args.branchId)
                .lt("ordinal", beforeOrdinal),
            )
            .order("desc")
            .take(limit + 1);
    const hasMore = messages.length > limit;
    const items = await Promise.all(
      messages.slice(0, limit).map(async (message) => {
        const manifest = await ctx.db
          .query("blob_manifests")
          .withIndex("by_workspace_public_id", (index) =>
            index.eq("workspaceId", args.workspaceId).eq("publicId", message.contentRef),
          )
          .unique();
        if (manifest?.status !== "available") {
          throw new Error("Available message content was not found in this workspace.");
        }
        return {
          id: message._id,
          publicId: message.publicId,
          workspaceId: message.workspaceId,
          chatId: message.chatId,
          branchId: message.branchId,
          ordinal: message.ordinal,
          role: message.role,
          contentRef: message.contentRef,
          objectKey: manifest.objectKey,
          backend: manifest.backend,
          envelopeVersion: manifest.envelopeVersion,
          contentPreview: message.contentPreview,
          contentType: message.contentType,
          byteLength: message.byteLength,
          sha256: message.sha256,
          replyToMessageId: message.replyToMessageId,
          runId: message.runId,
          createdAt: message.createdAt,
        };
      }),
    );
    items.reverse();

    return {
      items,
      nextBeforeOrdinal: hasMore ? (items[0]?.ordinal ?? null) : null,
      hasMore,
    };
  },
});

export const append = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    branchId: v.id("chat_branches"),
    publicId: v.optional(v.string()),
    role: messageRoleValidator,
    contentRef: v.string(),
    contentPreview: v.string(),
    replyToMessageId: v.optional(v.id("messages")),
    runId: v.optional(v.id("agent_runs")),
  },
  returns: messageSummaryValidator,
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.workspaceId !== args.workspaceId) {
      throw new Error("Chat not found in this workspace.");
    }
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.workspaceId !== args.workspaceId || branch.chatId !== args.chatId) {
      throw new Error("Branch not found in this chat.");
    }
    if ((args.role === "assistant" || args.role === "tool") && !args.runId) {
      throw new Error("Assistant and tool messages must identify their run.");
    }
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (
        !run ||
        run.workspaceId !== args.workspaceId ||
        run.chatId !== args.chatId ||
        run.branchId !== args.branchId ||
        run.status !== "running"
      ) {
        throw new Error("Active run not found for this message.");
      }
    }
    if (args.replyToMessageId) {
      const replyTarget = await ctx.db.get(args.replyToMessageId);
      if (
        !replyTarget ||
        replyTarget.workspaceId !== args.workspaceId ||
        replyTarget.chatId !== args.chatId
      ) {
        throw new Error("Reply target not found in this chat.");
      }
    }

    const contentRef = createPublicId("blob", args.contentRef);
    const manifest = await ctx.db
      .query("blob_manifests")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", contentRef),
      )
      .unique();
    if (manifest?.status !== "available") {
      throw new Error("Available message content was not found in this workspace.");
    }
    const contentPreview = requireText(
      args.contentPreview,
      "Content preview",
      convexConfig.domain.limits.contentPreviewLength,
    );
    const publicId = createPublicId("message", args.publicId);
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", publicId),
      )
      .unique();
    if (existing) {
      throw new Error("Message public ID already exists in this workspace.");
    }
    if (
      !Number.isSafeInteger(branch.nextMessageOrdinal) ||
      branch.nextMessageOrdinal >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error("Branch message ordinal is exhausted.");
    }

    const now = Date.now();
    const ordinal = branch.nextMessageOrdinal;
    const messageId = await ctx.db.insert("messages", {
      publicId,
      workspaceId: args.workspaceId,
      chatId: args.chatId,
      branchId: args.branchId,
      ordinal,
      role: args.role,
      contentRef,
      contentPreview,
      contentType: manifest.contentType,
      byteLength: manifest.byteLength,
      sha256: manifest.sha256,
      replyToMessageId: args.replyToMessageId,
      runId: args.runId,
      createdByUserId: user._id,
      createdAt: now,
    });
    await ctx.db.patch(args.branchId, { nextMessageOrdinal: ordinal + 1 });
    await ctx.db.patch(args.chatId, {
      updatedAt: now,
      ...(args.role === "user" &&
      chat.autoTitleStatus !== undefined &&
      chat.autoTitleStatus !== "generated" &&
      chat.autoTitleInputMessageId === undefined
        ? { autoTitleInputMessageId: messageId }
        : {}),
    });

    return {
      id: messageId,
      publicId,
      workspaceId: args.workspaceId,
      chatId: args.chatId,
      branchId: args.branchId,
      ordinal,
      role: args.role,
      contentRef,
      objectKey: manifest.objectKey,
      backend: manifest.backend,
      envelopeVersion: manifest.envelopeVersion,
      contentPreview,
      contentType: manifest.contentType,
      byteLength: manifest.byteLength,
      sha256: manifest.sha256,
      replyToMessageId: args.replyToMessageId,
      runId: args.runId,
      createdAt: now,
    };
  },
});
