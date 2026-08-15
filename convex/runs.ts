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
import {
  ACTIVE_BRANCH_RUN_ERROR,
  createRunLeaseCapability,
  hasActiveRunOnBranch,
  nextRunLeaseExpiresAt,
  RUN_LEASE_CANCELED_CODE,
  RUN_LEASE_CANCELED_MESSAGE,
  RUN_LEASE_VERSION,
  requireRunLeaseCapability,
  runNoLongerActiveError,
} from "./lib/runLeases";
import { requireWorkspacePermission } from "./lib/workspaceAuth";
import { messageSummaryValidator } from "./messages";

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

function summarizeRun(run: Doc<"agent_runs">) {
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

export const startTurn = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    branchId: v.id("chat_branches"),
    messagePublicId: v.optional(v.string()),
    runPublicId: v.optional(v.string()),
    contentRef: v.string(),
    contentPreview: v.string(),
    runtime: runRuntimeValidator,
    provider: v.string(),
    model: v.string(),
    providerSessionId: v.optional(v.string()),
    reasoningEffort: v.optional(reasoningEffortValidator),
    fastMode: v.optional(v.boolean()),
  },
  returns: v.object({
    message: messageSummaryValidator,
    run: runSummaryValidator,
    leaseExpiresAt: v.number(),
    leaseCapability: v.string(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "runs:execute");
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.workspaceId !== args.workspaceId) {
      throw new Error("Chat not found in this workspace.");
    }
    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.workspaceId !== args.workspaceId || branch.chatId !== args.chatId) {
      throw new Error("Branch not found in this chat.");
    }
    const now = Date.now();
    if (await hasActiveRunOnBranch(ctx, branch, now)) {
      throw new Error(ACTIVE_BRANCH_RUN_ERROR);
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
    if (
      !Number.isSafeInteger(branch.nextMessageOrdinal) ||
      branch.nextMessageOrdinal >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error("Branch message ordinal is exhausted.");
    }

    const messagePublicId = createPublicId("message", args.messagePublicId);
    const runPublicId = createPublicId("run", args.runPublicId);
    const [existingMessage, existingRun] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_workspace_public_id", (index) =>
          index.eq("workspaceId", args.workspaceId).eq("publicId", messagePublicId),
        )
        .unique(),
      ctx.db
        .query("agent_runs")
        .withIndex("by_workspace_public_id", (index) =>
          index.eq("workspaceId", args.workspaceId).eq("publicId", runPublicId),
        )
        .unique(),
    ]);
    if (existingMessage) throw new Error("Message public ID already exists in this workspace.");
    if (existingRun) throw new Error("Run public ID already exists in this workspace.");
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
    const ordinal = branch.nextMessageOrdinal;
    const messageId = await ctx.db.insert("messages", {
      publicId: messagePublicId,
      workspaceId: args.workspaceId,
      chatId: args.chatId,
      branchId: args.branchId,
      ordinal,
      role: "user",
      contentRef,
      contentPreview,
      contentType: manifest.contentType,
      byteLength: manifest.byteLength,
      sha256: manifest.sha256,
      createdByUserId: user._id,
      createdAt: now,
    });
    const leaseCapability = await createRunLeaseCapability();
    const runId = await ctx.db.insert("agent_runs", {
      publicId: runPublicId,
      workspaceId: args.workspaceId,
      chatId: args.chatId,
      branchId: args.branchId,
      inputMessageId: messageId,
      runtime: args.runtime,
      provider,
      model,
      providerSessionId,
      reasoningEffort: args.reasoningEffort,
      fastMode: args.fastMode,
      status: "running",
      leaseCapabilityHash: leaseCapability.hash,
      requestedByUserId: user._id,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const leaseExpiresAt = nextRunLeaseExpiresAt(now);
    await ctx.db.patch(args.branchId, {
      nextMessageOrdinal: ordinal + 1,
      runLeaseVersion: RUN_LEASE_VERSION,
      activeRunId: runId,
      activeRunLeaseExpiresAt: leaseExpiresAt,
    });
    await ctx.db.patch(args.chatId, {
      updatedAt: now,
      lastUserMessageAt: now,
      ...(chat.autoTitleStatus !== undefined &&
      chat.autoTitleStatus !== "generated" &&
      chat.autoTitleInputMessageId === undefined
        ? { autoTitleInputMessageId: messageId }
        : {}),
    });

    return {
      message: {
        id: messageId,
        publicId: messagePublicId,
        workspaceId: args.workspaceId,
        chatId: args.chatId,
        branchId: args.branchId,
        ordinal,
        role: "user" as const,
        contentRef,
        objectKey: manifest.objectKey,
        backend: manifest.backend,
        envelopeVersion: manifest.envelopeVersion,
        contentPreview,
        contentType: manifest.contentType,
        byteLength: manifest.byteLength,
        sha256: manifest.sha256,
        createdAt: now,
      },
      run: {
        id: runId,
        publicId: runPublicId,
        workspaceId: args.workspaceId,
        chatId: args.chatId,
        branchId: args.branchId,
        inputMessageId: messageId,
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
      },
      leaseExpiresAt,
      leaseCapability: leaseCapability.capability,
    };
  },
});

export const renewLease = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    runId: v.id("agent_runs"),
    leaseCapability: v.string(),
  },
  returns: v.object({ leaseExpiresAt: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "runs:execute");
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.workspaceId !== args.workspaceId ||
      run.requestedByUserId !== user._id ||
      run.status !== "running" ||
      run.leaseHandoffAt !== undefined
    ) {
      throw runNoLongerActiveError();
    }
    await requireRunLeaseCapability(run, args.leaseCapability);
    const branch = await ctx.db.get(run.branchId);
    const now = Date.now();
    if (
      !branch ||
      branch.workspaceId !== args.workspaceId ||
      branch.chatId !== run.chatId ||
      branch.activeRunId !== run._id ||
      branch.activeRunLeaseExpiresAt === undefined ||
      branch.activeRunLeaseExpiresAt <= now
    ) {
      throw runNoLongerActiveError();
    }
    const leaseExpiresAt = nextRunLeaseExpiresAt(now);
    await ctx.db.patch(branch._id, { activeRunLeaseExpiresAt: leaseExpiresAt });
    return { leaseExpiresAt };
  },
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
  returns: v.object({
    run: runSummaryValidator,
    leaseExpiresAt: v.number(),
    leaseCapability: v.string(),
  }),
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
    if (await hasActiveRunOnBranch(ctx, branch, now)) throw new Error(ACTIVE_BRANCH_RUN_ERROR);
    const leaseCapability = await createRunLeaseCapability();
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
      leaseCapabilityHash: leaseCapability.hash,
      requestedByUserId: user._id,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const leaseExpiresAt = nextRunLeaseExpiresAt(now);
    await ctx.db.patch(branch._id, {
      runLeaseVersion: RUN_LEASE_VERSION,
      activeRunId: runId,
      activeRunLeaseExpiresAt: leaseExpiresAt,
    });
    return {
      run: {
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
      },
      leaseExpiresAt,
      leaseCapability: leaseCapability.capability,
    };
  },
});

export const handoffLease = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    runId: v.id("agent_runs"),
    leaseCapability: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "runs:execute");
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.workspaceId !== args.workspaceId ||
      run.requestedByUserId !== user._id ||
      run.status !== "running"
    ) {
      throw runNoLongerActiveError();
    }
    await requireRunLeaseCapability(run, args.leaseCapability);
    const branch = await ctx.db.get(run.branchId);
    if (
      !branch ||
      branch.workspaceId !== args.workspaceId ||
      branch.chatId !== run.chatId ||
      branch.runLeaseVersion !== RUN_LEASE_VERSION ||
      branch.activeRunId !== run._id
    ) {
      throw runNoLongerActiveError();
    }
    if (run.leaseHandoffAt === undefined) {
      const now = Date.now();
      await ctx.db.patch(run._id, { leaseHandoffAt: now, updatedAt: now });
    }
    return true;
  },
});

export const cancelLease = mutation({
  args: {
    workspacePublicId: v.string(),
    runPublicId: v.string(),
  },
  returns: runSummaryValidator,
  handler: async (ctx, args) => {
    const workspacePublicId = createPublicId("ws", args.workspacePublicId);
    const runPublicId = createPublicId("run", args.runPublicId);
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (index) => index.eq("publicId", workspacePublicId))
      .unique();
    if (!workspace) throw runNoLongerActiveError();
    const { user } = await requireWorkspacePermission(ctx, workspace._id, "runs:execute");
    const run = await ctx.db
      .query("agent_runs")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", workspace._id).eq("publicId", runPublicId),
      )
      .unique();
    if (!run || run.requestedByUserId !== user._id) {
      throw runNoLongerActiveError();
    }
    if (run.status !== "running") return summarizeRun(run);
    const branch = await ctx.db.get(run.branchId);
    if (
      !branch ||
      branch.workspaceId !== workspace._id ||
      branch.chatId !== run.chatId ||
      branch.runLeaseVersion !== RUN_LEASE_VERSION ||
      branch.activeRunId !== run._id
    ) {
      throw runNoLongerActiveError();
    }

    const completedAt = Date.now();
    await ctx.db.patch(run._id, {
      status: "canceled",
      errorCode: RUN_LEASE_CANCELED_CODE,
      errorMessage: RUN_LEASE_CANCELED_MESSAGE,
      completedAt,
      updatedAt: completedAt,
    });
    await ctx.db.patch(branch._id, {
      runLeaseVersion: RUN_LEASE_VERSION,
      activeRunId: undefined,
      activeRunLeaseExpiresAt: undefined,
    });
    return summarizeRun({
      ...run,
      status: "canceled",
      errorCode: RUN_LEASE_CANCELED_CODE,
      errorMessage: RUN_LEASE_CANCELED_MESSAGE,
      completedAt,
      updatedAt: completedAt,
    });
  },
});

export const complete = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    runId: v.id("agent_runs"),
    leaseCapability: v.optional(v.string()),
    status: terminalRunStatusValidator,
    outputMessageId: v.optional(v.id("messages")),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: runSummaryValidator,
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "runs:execute");
    const run = await ctx.db.get(args.runId);
    if (!run || run.workspaceId !== args.workspaceId || run.requestedByUserId !== user._id) {
      throw new Error("Run not found in this workspace.");
    }
    await requireRunLeaseCapability(run, args.leaseCapability);
    const branch = await ctx.db.get(run.branchId);
    const branchUsesLeases = branch?.runLeaseVersion === RUN_LEASE_VERSION;
    if (
      run.status === "running" &&
      (run.leaseHandoffAt !== undefined ||
        (branchUsesLeases &&
          (branch?.activeRunId !== run._id ||
            branch.activeRunLeaseExpiresAt === undefined ||
            branch.activeRunLeaseExpiresAt <= Date.now())))
    ) {
      throw runNoLongerActiveError();
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
        return summarizeRun(run);
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
    if (branch?.activeRunId === run._id) {
      await ctx.db.patch(branch._id, {
        runLeaseVersion: RUN_LEASE_VERSION,
        activeRunId: undefined,
        activeRunLeaseExpiresAt: undefined,
      });
    }
    if (args.status === "succeeded" && completedOutputMessage) {
      const chat = await ctx.db.get(run.chatId);
      if (!chat || (chat.latestCompletedAt ?? 0) <= completedAt) {
        await ctx.db.patch(run.chatId, {
          latestCompletedMessageId: completedOutputMessage._id,
          latestCompletedMessagePublicId: completedOutputMessage.publicId,
          latestCompletedAt: completedAt,
          updatedAt: completedAt,
        });
      }
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
