/** Writes sanitized first-party analytics events into the outbox. */

import type { MutationCtx } from "../../_generated/server";
import type { AnalyticsEvent } from "./events";

function isAnalyticsHardDisabled(): boolean {
  return process.env.ANALYTICS_DISABLED === "true";
}

export async function enqueueAnalyticsEvent(
  ctx: MutationCtx,
  event: AnalyticsEvent,
): Promise<void> {
  if (isAnalyticsHardDisabled()) return;

  const now = Date.now();
  await ctx.db.insert("app_events_outbox", {
    eventName: event.eventName,
    insertId: event.insertId,
    distinctId: event.distinctId,
    properties: event.properties,
    occurredAt: event.occurredAt,
    attempts: 0,
    nextAttemptAt: now,
    lockedUntil: undefined,
    lastError: undefined,
    createdAt: now,
  });
}
