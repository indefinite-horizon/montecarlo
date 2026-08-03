/**
 * First-party analytics event registry, builders, and sanitization.
 *
 * The provider boundary is intentionally narrow: every product call site goes
 * through a builder defined here, and the only place that imports a real
 * analytics SDK is `convex/actions/analyticsFlushNode.ts`.
 */

import {
  type AnalyticsPrimitive,
  type AnalyticsProperties,
  type AnalyticsValue,
  sanitizeProperties,
} from "../../../lib/analytics/sanitize";
import type { Id } from "../../_generated/dataModel";

export type { AnalyticsPrimitive, AnalyticsProperties, AnalyticsValue };
export { sanitizeProperties };

export const ANALYTICS_EVENT_NAMES = [
  "user signed up",
  "user signed in",
  "app error shown",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

const EVENT_NAME_SET: ReadonlySet<string> = new Set(ANALYTICS_EVENT_NAMES);

export type AnalyticsEvent = {
  eventName: AnalyticsEventName;
  insertId: string;
  distinctId: string;
  occurredAt: number;
  properties: AnalyticsProperties;
};

export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return EVENT_NAME_SET.has(name);
}

export function buildInsertId(...parts: (string | number)[]): string {
  return parts.map((part) => String(part)).join(":");
}

type BaseInput = {
  userId?: Id<"users"> | string;
  distinctId?: string;
  occurredAt?: number;
};

function resolveDistinctId(input: BaseInput): string {
  if (input.distinctId) return input.distinctId;
  if (input.userId) return String(input.userId);
  return "anonymous";
}

function resolveOccurredAt(input: BaseInput): number {
  return input.occurredAt ?? Date.now();
}

export type UserSignedUpInput = BaseInput & {
  authSubject: string;
  method: "email" | "google";
};

export function buildUserSignedUpEvent(input: UserSignedUpInput): AnalyticsEvent {
  return {
    eventName: "user signed up",
    insertId: buildInsertId("user_signed_up", input.authSubject),
    distinctId: resolveDistinctId(input),
    occurredAt: resolveOccurredAt(input),
    properties: sanitizeProperties({
      user_id: input.userId ? String(input.userId) : null,
      auth_subject: input.authSubject,
      method: input.method,
    }),
  };
}

export type UserSignedInInput = BaseInput & {
  method: "email" | "google";
};

export function buildUserSignedInEvent(input: UserSignedInInput): AnalyticsEvent {
  const occurredAt = resolveOccurredAt(input);
  return {
    eventName: "user signed in",
    insertId: buildInsertId("user_signed_in", resolveDistinctId(input), occurredAt),
    distinctId: resolveDistinctId(input),
    occurredAt,
    properties: sanitizeProperties({
      user_id: input.userId ? String(input.userId) : null,
      method: input.method,
    }),
  };
}

export type AppErrorShownInput = BaseInput & {
  surface: "root" | "route" | "server";
  errorKind: "network" | "render" | "convex_query" | "unknown";
};

export function buildAppErrorShownEvent(input: AppErrorShownInput): AnalyticsEvent {
  const occurredAt = resolveOccurredAt(input);
  return {
    eventName: "app error shown",
    insertId: buildInsertId("app_error_shown", resolveDistinctId(input), input.surface, occurredAt),
    distinctId: resolveDistinctId(input),
    occurredAt,
    properties: sanitizeProperties({
      user_id: input.userId ? String(input.userId) : null,
      surface: input.surface,
      error_kind: input.errorKind,
    }),
  };
}
