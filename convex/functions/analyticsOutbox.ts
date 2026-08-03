/** Internal queries/mutations the analytics flush cron uses to drain the outbox. */

import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { convexConfig } from "../config";
import { logger } from "../lib/logger";

const outboxConfig = convexConfig.analytics.outbox;

export const MAX_ATTEMPTS = outboxConfig.maxAttempts;
export const LOCK_TTL_MS = outboxConfig.lockTtlMs;
export const MAX_AGE_MS = outboxConfig.maxAgeMs;
export const BATCH_SIZE = outboxConfig.batchSize;
export const PRUNE_BATCH_SIZE = outboxConfig.pruneBatchSize;
export const MIN_FLUSH_INTERVAL_MS = outboxConfig.minFlushIntervalMs;

const RETRY_BACKOFF_MS: readonly [number, ...number[]] = outboxConfig.retryBackoffMs;
const DEFAULT_RETRY_BACKOFF_MS = RETRY_BACKOFF_MS[0];

function backoffForAttempt(attempts: number): number {
  const idx = Math.max(0, Math.min(attempts, RETRY_BACKOFF_MS.length - 1));
  return RETRY_BACKOFF_MS[idx] ?? DEFAULT_RETRY_BACKOFF_MS;
}

export const tryAcquireFlushLease = internalMutation({
  args: { now: v.number(), minIntervalMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const minInterval = args.minIntervalMs ?? MIN_FLUSH_INTERVAL_MS;
    const existing = await ctx.db.query("app_analytics_flush_state").first();
    if (existing) {
      if (args.now - existing.lastFlushAt < minInterval) {
        return { acquired: false, retryAfterMs: minInterval - (args.now - existing.lastFlushAt) };
      }
      await ctx.db.patch(existing._id, { lastFlushAt: args.now });
    } else {
      await ctx.db.insert("app_analytics_flush_state", { lastFlushAt: args.now });
    }
    return { acquired: true, retryAfterMs: 0 };
  },
});

export const claimBatch = internalMutation({
  args: { now: v.number(), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.batchSize ?? BATCH_SIZE, BATCH_SIZE));
    const lockedUntil = args.now + LOCK_TTL_MS;

    const candidates = await ctx.db
      .query("app_events_outbox")
      .withIndex("by_next_attempt", (q) => q.lte("nextAttemptAt", args.now))
      .order("asc")
      .take(limit * 2);

    const claimed: Doc<"app_events_outbox">[] = [];
    for (const row of candidates) {
      if (claimed.length >= limit) break;
      if (row.lockedUntil !== undefined && row.lockedUntil > args.now) continue;
      await ctx.db.patch(row._id, { lockedUntil });
      claimed.push({ ...row, lockedUntil });
    }
    return claimed.map((row) => ({
      _id: row._id,
      eventName: row.eventName,
      insertId: row.insertId,
      distinctId: row.distinctId,
      properties: row.properties as Record<string, unknown>,
      occurredAt: row.occurredAt,
      attempts: row.attempts,
    }));
  },
});

export const markSent = internalMutation({
  args: { ids: v.array(v.id("app_events_outbox")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (row) await ctx.db.delete(id);
    }
  },
});

export const markFailed = internalMutation({
  args: {
    failures: v.array(
      v.object({
        id: v.id("app_events_outbox"),
        error: v.string(),
        now: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const failure of args.failures) {
      const row = await ctx.db.get(failure.id);
      if (!row) continue;
      const nextAttempts = row.attempts + 1;
      if (nextAttempts >= MAX_ATTEMPTS) {
        logger.debug("analytics outbox row dead-lettered", {
          outbox_id: row._id,
          event_name: row.eventName,
          attempts: nextAttempts,
          error_message: failure.error.slice(0, 200),
        });
        await ctx.db.delete(failure.id);
        continue;
      }
      await ctx.db.patch(failure.id, {
        attempts: nextAttempts,
        nextAttemptAt: failure.now + backoffForAttempt(nextAttempts - 1),
        lockedUntil: undefined,
        lastError: failure.error.slice(0, 500),
      });
    }
  },
});

export const prune = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    return await pruneOldRows(ctx, args.now);
  },
});

async function pruneOldRows(ctx: MutationCtx, now: number): Promise<number> {
  const cutoff = now - MAX_AGE_MS;
  let removed = 0;
  for (let pass = 0; pass < 5; pass++) {
    const rows = await ctx.db
      .query("app_events_outbox")
      .withIndex("by_created_at", (q) => q.lt("createdAt", cutoff))
      .order("asc")
      .take(PRUNE_BATCH_SIZE);
    if (rows.length === 0) break;
    for (const row of rows) {
      await ctx.db.delete(row._id);
      removed += 1;
    }
    if (rows.length < PRUNE_BATCH_SIZE) break;
  }
  if (removed > 0) {
    logger.debug("analytics outbox prune removed expired rows", {
      removed_count: removed,
      cutoff_ms: cutoff,
    });
  }
  return removed;
}

export const stats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const oldest = await ctx.db
      .query("app_events_outbox")
      .withIndex("by_created_at", (q) => q)
      .order("asc")
      .first();
    return { oldestCreatedAt: oldest?.createdAt ?? null };
  },
});

export type OutboxClaimedRow = {
  _id: Id<"app_events_outbox">;
  eventName: string;
  insertId: string;
  distinctId: string;
  properties: Record<string, unknown>;
  occurredAt: number;
  attempts: number;
};
