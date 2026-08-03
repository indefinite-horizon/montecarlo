/** Effect helpers for analytics provider calls. */

import { Effect } from "effect";
import type { Id } from "../_generated/dataModel";
import { type AppError, ExternalServiceError } from "./AppError";

export type AnalyticsCaptureClient = {
  captureImmediate(input: {
    distinctId: string;
    event: string;
    uuid: string;
    timestamp: Date;
    properties: Record<string, unknown>;
  }): Promise<void>;
};

export type AnalyticsRow = {
  _id: Id<"app_events_outbox">;
  eventName: string;
  insertId: string;
  distinctId: string;
  properties: Record<string, unknown>;
  occurredAt: number;
};

export function captureAnalyticsRowEffect(
  client: AnalyticsCaptureClient,
  row: AnalyticsRow,
): Effect.Effect<void, AppError, never> {
  return Effect.tryPromise({
    try: () =>
      client.captureImmediate({
        distinctId: row.distinctId,
        event: row.eventName,
        uuid: row.insertId,
        timestamp: new Date(row.occurredAt),
        properties: row.properties,
      }),
    catch: (error) =>
      new ExternalServiceError({
        service: "posthog",
        message: error instanceof Error ? error.message : String(error),
      }),
  });
}
