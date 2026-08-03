/** Convex schema for the reusable template starter app. */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
});
