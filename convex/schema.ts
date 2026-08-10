/** Multi-tenant control-plane schema for Monte Carlo workspaces. */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  blobBackendValidator,
  blobStatusValidator,
  branchAnchorTypeValidator,
  branchSelectionValidator,
  messageRoleValidator,
  reasoningEffortValidator,
  runRuntimeValidator,
  runStatusValidator,
  workspaceMembershipStatusValidator,
  workspaceRoleValidator,
  workspaceStorageModeValidator,
} from "./lib/domainValidators";

export default defineSchema({
  // App-owned identity table. Better Auth owns credentials, sessions, and
  // provider accounts in its component schema; this table gives app logic a
  // stable `Id<"users">` for ownership, analytics identity, and future joins.
  users: defineTable({
    authSubject: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_auth_subject", ["authSubject"])
    .index("by_email", ["email"]),

  auth_audit_logs: defineTable({
    event: v.union(v.literal("auth.session_created"), v.literal("auth.account_linked")),
    actorAuthSubject: v.string(),
    provider: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_created_at", ["createdAt"])
    .index("by_actor_auth_subject", ["actorAuthSubject"]),

  // First-party analytics outbox. Mutations enqueue sanitized events here in
  // the same transaction as the originating CUJ; a periodic flush action
  // drains them to the configured provider (PostHog) and deletes delivered
  // rows so the table cannot grow without bound. Failed rows back off with
  // attempt counts and are pruned by age + max-attempts in the same job.
  app_events_outbox: defineTable({
    eventName: v.string(),
    insertId: v.string(),
    distinctId: v.string(),
    properties: v.any(),
    occurredAt: v.number(),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lockedUntil: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_next_attempt", ["nextAttemptAt"])
    .index("by_created_at", ["createdAt"]),

  // Singleton table holding the most recent flush start time. The flush
  // action acquires a lease here before doing work, refusing to fire more
  // than once per MIN_FLUSH_INTERVAL_MS so ad-hoc triggers (or a
  // misconfigured cron) cannot hammer the provider.
  app_analytics_flush_state: defineTable({
    lastFlushAt: v.number(),
  }),

  // Dev-only: stores magic link URLs so the frontend can auto-redirect
  // without a real inbox. Production code never writes useful rows here.
  dev_magic_links: defineTable({
    email: v.string(),
    url: v.string(),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_created_at", ["createdAt"]),

  // Workspaces are tenant roots. Every table owned by a tenant below carries
  // workspaceId explicitly; users and workspaces themselves are global roots.
  workspaces: defineTable({
    publicId: v.string(),
    name: v.string(),
    storageMode: workspaceStorageModeValidator,
    schemaVersion: v.number(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_public_id", ["publicId"]),

  workspace_memberships: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: workspaceRoleValidator,
    status: workspaceMembershipStatusValidator,
    invitedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_user", ["workspaceId", "userId"])
    .index("by_workspace_public_id", ["workspaceId", "publicId"])
    .index("by_user_status", ["userId", "status"]),

  projects: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    createdByUserId: v.id("users"),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_public_id", ["workspaceId", "publicId"])
    .index("by_workspace_updated_at", ["workspaceId", "updatedAt"]),

  chats: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    projectId: v.optional(v.id("projects")),
    title: v.string(),
    autoTitleStatus: v.optional(
      v.union(v.literal("pending"), v.literal("generating"), v.literal("generated")),
    ),
    autoTitleInputMessageId: v.optional(v.id("messages")),
    autoTitleClaimToken: v.optional(v.string()),
    autoTitleClaimedAt: v.optional(v.number()),
    autoTitleProvider: v.optional(v.string()),
    autoTitleModel: v.optional(v.string()),
    rootBranchId: v.optional(v.id("chat_branches")),
    rootBranchPublicId: v.optional(v.string()),
    latestCompletedMessageId: v.optional(v.id("messages")),
    latestCompletedMessagePublicId: v.optional(v.string()),
    latestCompletedAt: v.optional(v.number()),
    // Optional for legacy rows; every newly-created chat initializes this to
    // createdAt and user messages advance it.
    lastUserMessageAt: v.optional(v.number()),
    createdByUserId: v.id("users"),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_public_id", ["workspaceId", "publicId"])
    .index("by_workspace_updated_at", ["workspaceId", "updatedAt"])
    .index("by_workspace_project_updated_at", ["workspaceId", "projectId", "updatedAt"])
    .index("by_workspace_archived_updated_at", ["workspaceId", "archivedAt", "updatedAt"])
    .index("by_workspace_archived_last_user_message_at", [
      "workspaceId",
      "archivedAt",
      "lastUserMessageAt",
    ])
    .index("by_workspace_project_archived_updated_at", [
      "workspaceId",
      "projectId",
      "archivedAt",
      "updatedAt",
    ])
    .index("by_workspace_project_archived_last_user_message_at", [
      "workspaceId",
      "projectId",
      "archivedAt",
      "lastUserMessageAt",
    ]),

  chat_user_states: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    userId: v.id("users"),
    lastReadMessageId: v.optional(v.id("messages")),
    lastReadMessagePublicId: v.optional(v.string()),
    pinnedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_user_chat", ["workspaceId", "userId", "chatId"])
    .index("by_workspace_chat", ["workspaceId", "chatId"]),

  chat_branches: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    parentBranchId: v.optional(v.id("chat_branches")),
    anchorType: branchAnchorTypeValidator,
    anchorSourceBranchId: v.optional(v.id("chat_branches")),
    anchorSourceMessageId: v.optional(v.id("messages")),
    anchorSelection: v.optional(branchSelectionValidator),
    anchorPrompt: v.optional(v.string()),
    title: v.optional(v.string()),
    contextMessageIds: v.array(v.id("messages")),
    contextPreview: v.optional(v.string()),
    depth: v.number(),
    nextMessageOrdinal: v.number(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_workspace_public_id", ["workspaceId", "publicId"])
    .index("by_workspace_chat_created_at", ["workspaceId", "chatId", "createdAt"]),

  messages: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    chatId: v.id("chats"),
    branchId: v.id("chat_branches"),
    ordinal: v.number(),
    role: messageRoleValidator,
    contentRef: v.string(),
    contentPreview: v.string(),
    contentType: v.string(),
    byteLength: v.number(),
    sha256: v.string(),
    replyToMessageId: v.optional(v.id("messages")),
    runId: v.optional(v.id("agent_runs")),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_workspace_public_id", ["workspaceId", "publicId"])
    .index("by_workspace_chat_created_at", ["workspaceId", "chatId", "createdAt"])
    .index("by_workspace_branch_ordinal", ["workspaceId", "branchId", "ordinal"]),

  agent_runs: defineTable({
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
    requestedByUserId: v.id("users"),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_public_id", ["workspaceId", "publicId"])
    .index("by_workspace_chat_updated_at", ["workspaceId", "chatId", "updatedAt"]),

  blob_manifests: defineTable({
    publicId: v.string(),
    workspaceId: v.id("workspaces"),
    backend: blobBackendValidator,
    objectKey: v.string(),
    envelopeVersion: v.number(),
    contentType: v.string(),
    byteLength: v.number(),
    sha256: v.string(),
    status: blobStatusValidator,
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_public_id", ["workspaceId", "publicId"])
    .index("by_workspace_sha256", ["workspaceId", "sha256"]),
});
