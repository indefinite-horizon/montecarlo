/** Unit tests for the Effect-backed analytics helper. */

import { describe, expect, it } from "vitest";
import { formatAppError, isAppError } from "../../convex/effect/AppError";
import { captureAnalyticsRowEffect } from "../../convex/effect/analytics";
import { runPromiseEffect } from "../../convex/effect/runtime";

describe("analytics Effect helper", () => {
  it("passes sanitized row fields to the provider client", async () => {
    const calls: unknown[] = [];
    await runPromiseEffect(
      captureAnalyticsRowEffect(
        {
          captureImmediate: async (input) => {
            calls.push(input);
          },
        },
        {
          _id: "app_events_outbox_1" as never,
          eventName: "user signed up",
          insertId: "insert-1",
          distinctId: "users_1",
          properties: { user_id: "users_1" },
          occurredAt: 1_700_000_000_000,
        },
      ),
    );

    expect(calls).toEqual([
      {
        distinctId: "users_1",
        event: "user signed up",
        uuid: "insert-1",
        timestamp: new Date(1_700_000_000_000),
        properties: { user_id: "users_1" },
      },
    ]);
  });

  it("maps provider failures to tagged app errors", async () => {
    try {
      await runPromiseEffect(
        captureAnalyticsRowEffect(
          {
            captureImmediate: async () => {
              throw new Error("provider unavailable");
            },
          },
          {
            _id: "app_events_outbox_1" as never,
            eventName: "user signed up",
            insertId: "insert-1",
            distinctId: "users_1",
            properties: {},
            occurredAt: 1_700_000_000_000,
          },
        ),
      );
      throw new Error("expected provider failure");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(formatAppError(error)).toBe("posthog: provider unavailable");
      }
    }
  });
});
