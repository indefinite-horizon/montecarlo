/** Provider-agnostic model and agent-harness run lifecycle. */

import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { convexConfig } from "./config";
import { createPublicId, optionalText, requireText } from "./lib/domainValidation";
import {
  reasoningEffortValidator,
  runRuntimeValidator,
  runStatusValidator,
  terminalRunStatusValidator,
} from "./lib/domainValidators";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

const runSummaryValidator = v.object({
  id: v.id("agent_runs"),
  publicId: v.string(),
  workspaceId: v.id("workspaces"),
  chatId: v.id("chats"),
  branchId: v.id("chat_branches"),
  inputMessageId: v.optional(v.id("messages")),
  outputMessageId: v.optional(v.id("messages")),
  runtime: runRuntimeValidator,
  provider: v.string(),
  model: v.string(),
  providerSessionId: v.optional(v.string()),
  reasoningEffort: v.optional(reasoningEffortValidator),
  fastMode: v.optional(v.boolean()),
  status: runStatusValidator,
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    branchId: v.id("chat_branches"),
    publicId: v.optional(v.string()),
    inputMessageId: v.optional(v.id("messages")),
    runtime: runRuntimeValidator,
    provider: v.string(),
    model: v.string(),
    providerSessionId: v.optional(v.string()),
    reasoningEffort: v.optional(reasoningEffortValidator),
    fastMode: v.optional(v.boolean()),
  },
  returns: runSummaryValidator,
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "runs:execute");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.workspaceId !== args.workspaceId) {
      throw new Error("Chat not found in this workspace.");
    }
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.workspaceId !== args.workspaceId || branch.chatId !== args.chatId) {
      throw new Error("Branch not found in this chat.");
    }
    if (args.inputMessageId) {
      const inputMessage = await ctx.db.get(args.inputMessageId);
      if (
        !inputMessage ||
        inputMessage.workspaceId !== args.workspaceId ||
        inputMessage.chatId !== args.chatId ||
        inputMessage.branchId !== args.branchId
      ) {
        throw new Error("Input message not found in this branch.");
      }
    }

    const publicId = createPublicId("run", args.publicId);
    const provider = requireText(
      args.provider,
      "Provider",
      convexConfig.domain.limits.providerNameLength,
    );
    const model = requireText(args.model, "Model", convexConfig.domain.limits.modelNameLength);
    const providerSessionId = optionalText(
      args.providerSessionId,
      "Provider session ID",
      convexConfig.domain.limits.providerSessionIdLength,
    );
    const existing = await ctx.db
      .query("agent_runs")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", publicId),
      )
      .unique();
    if (existing) {
      throw new Error("Run public ID already exists in this workspace.");
    }

    const now = Date.now();
    const runId = await ctx.db.insert("agent_runs", {
      publicId,
      workspaceId: args.workspaceId,
      chatId: args.chatId,
      branchId: args.branchId,
      inputMessageId: args.inputMessageId,
      runtime: args.runtime,
      provider,
      model,
      providerSessionId,
      reasoningEffort: args.reasoningEffort,
      fastMode: args.fastMode,
      status: "running",
      requestedByUserId: user._id,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id: runId,
      publicId,
      workspaceId: args.workspaceId,
      chatId: args.chatId,
      branchId: args.branchId,
      inputMessageId: args.inputMessageId,
      runtime: args.runtime,
      provider,
      model,
      providerSessionId,
      reasoningEffort: args.reasoningEffort,
      fastMode: args.fastMode,
      status: "running" as const,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  },
});

export const complete = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    runId: v.id("agent_runs"),
    status: terminalRunStatusValidator,
    outputMessageId: v.optional(v.id("messages")),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: runSummaryValidator,
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "runs:execute");
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== args.workspaceId) {
      throw new Error("Run not found in this workspace.");
    }
    let completedOutputMessage: Doc<"messages"> | null = null;
    if (args.outputMessageId) {
      const outputMessage = await ctx.db.get(args.outputMessageId);
      if (
        !outputMessage ||
        outputMessage.workspaceId !== args.workspaceId ||
        outputMessage.chatId !== run.chatId ||
        outputMessage.branchId !== run.branchId ||
        outputMessage.runId !== run._id ||
        (outputMessage.role !== "assistant" && outputMessage.role !== "tool")
      ) {
        throw new Error("Output message does not belong to this run.");
      }
      completedOutputMessage = outputMessage;
    }

    const errorCode =
      args.status === "failed"
        ? optionalText(args.errorCode, "Run error code", convexConfig.domain.limits.errorCodeLength)
        : undefined;
    const errorMessage =
      args.status === "failed"
        ? optionalText(
            args.errorMessage,
            "Run error message",
            convexConfig.domain.limits.errorMessageLength,
          )
        : undefined;
    if (run.status !== "running") {
      if (
        run.status === args.status &&
        run.outputMessageId === args.outputMessageId &&
        run.errorCode === errorCode &&
        run.errorMessage === errorMessage
      ) {
        return {
          id: run._id,
          publicId: run.publicId,
          workspaceId: run.workspaceId,
          chatId: run.chatId,
          branchId: run.branchId,
          inputMessageId: run.inputMessageId,
          outputMessageId: run.outputMessageId,
          runtime: run.runtime,
          provider: run.provider,
          model: run.model,
          providerSessionId: run.providerSessionId,
          reasoningEffort: run.reasoningEffort,
          fastMode: run.fastMode,
          status: run.status,
          errorCode: run.errorCode,
          errorMessage: run.errorMessage,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        };
      }
      throw new Error("Run has already completed.");
    }

    const completedAt = Date.now();
    await ctx.db.patch(run._id, {
      outputMessageId: args.outputMessageId,
      status: args.status,
      errorCode,
      errorMessage,
      completedAt,
      updatedAt: completedAt,
    });
    if (args.status === "succeeded" && completedOutputMessage) {
      await ctx.db.patch(run.chatId, {
        latestCompletedMessageId: completedOutputMessage._id,
        latestCompletedMessagePublicId: completedOutputMessage.publicId,
        latestCompletedAt: completedAt,
        updatedAt: completedAt,
      });
    }
    return {
      id: run._id,
      publicId: run.publicId,
      workspaceId: run.workspaceId,
      chatId: run.chatId,
      branchId: run.branchId,
      inputMessageId: run.inputMessageId,
      outputMessageId: args.outputMessageId,
      runtime: run.runtime,
      provider: run.provider,
      model: run.model,
      providerSessionId: run.providerSessionId,
      reasoningEffort: run.reasoningEffort,
      fastMode: run.fastMode,
      status: args.status,
      errorCode,
      errorMessage,
      startedAt: run.startedAt,
      completedAt,
      createdAt: run.createdAt,
      updatedAt: completedAt,
    };
  },
});
