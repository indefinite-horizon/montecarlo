/**
 * Analytics outbox flush. This is the only Convex file allowed to import a
 * real analytics SDK; everything else goes through the typed outbox.
 */
"use node";

import { PostHog } from "posthog-node";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { formatAppError, isAppError } from "../effect/AppError";
import { captureAnalyticsRowEffect } from "../effect/analytics";
import { runPromiseEffect } from "../effect/runtime";
import { logger } from "../lib/logger";

type ClaimedRow = {
  _id: Id<"app_events_outbox">;
  eventName: string;
  insertId: string;
  distinctId: string;
  properties: Record<string, unknown>;
  occurredAt: number;
  attempts: number;
};

type ProviderConfig = {
  projectToken: string;
  host: string;
};

function loadProviderConfig(): ProviderConfig | null {
  if (process.env.ANALYTICS_DISABLED === "true") return null;
  const projectToken = process.env.POSTHOG_PROJECT_TOKEN ?? "";
  if (projectToken === "") return null;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  return { projectToken, host };
}

async function captureOne(client: PostHog, row: ClaimedRow): Promise<void> {
  await runPromiseEffect(captureAnalyticsRowEffect(client, row));
}

function formatFailure(error: unknown): string {
  if (isAppError(error)) return formatAppError(error);
  if (error instanceof Error) return error.message;
  return String(error);
}

export const flushOutbox = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ sent: number; failed: number; pruned: number; skipped?: "rate_limited" }> => {
    const lease: { acquired: boolean; retryAfterMs: number } = await ctx.runMutation(
      internal.functions.analyticsOutbox.tryAcquireFlushLease,
      { now: Date.now() },
    );
    if (!lease.acquired) {
      logger.debug("analytics flush skipped (rate limited)", {
        retry_after_ms: lease.retryAfterMs,
      });
      return { sent: 0, failed: 0, pruned: 0, skipped: "rate_limited" };
    }

    const config = loadProviderConfig();
    const pruneResult: number = await ctx.runMutation(internal.functions.analyticsOutbox.prune, {
      now: Date.now(),
    });

    if (config === null) {
      return { sent: 0, failed: 0, pruned: pruneResult };
    }

    const claimed = (await ctx.runMutation(internal.functions.analyticsOutbox.claimBatch, {
      now: Date.now(),
    })) as ClaimedRow[];

    if (claimed.length === 0) {
      return { sent: 0, failed: 0, pruned: pruneResult };
    }

    const client = new PostHog(config.projectToken, {
      host: config.host,
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: 10_000,
    });

    const succeeded: Id<"app_events_outbox">[] = [];
    const failures: { id: Id<"app_events_outbox">; error: string; now: number }[] = [];

    try {
      for (const row of claimed) {
        try {
          await captureOne(client, row);
          succeeded.push(row._id);
        } catch (error) {
          failures.push({ id: row._id, error: formatFailure(error), now: Date.now() });
        }
      }
      await client.shutdown(5_000);
    } catch (error) {
      logger.debug("analytics provider shutdown error (non-fatal)", {
        error_message: error instanceof Error ? error.message : String(error),
      });
    }

    if (succeeded.length > 0) {
      await ctx.runMutation(internal.functions.analyticsOutbox.markSent, { ids: succeeded });
    }
    if (failures.length > 0) {
      await ctx.runMutation(internal.functions.analyticsOutbox.markFailed, { failures });
    }

    return { sent: succeeded.length, failed: failures.length, pruned: pruneResult };
  },
});
