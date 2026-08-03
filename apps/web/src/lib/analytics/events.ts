/** Frontend analytics event registry, builders, and re-exported sanitizer. */

import { ConvexError } from "convex/values";
import {
  type AnalyticsProperties,
  sanitizeProperties,
} from "../../../../../lib/analytics/sanitize";

export { sanitizeProperties };

/**
 * Event names emitted from the browser. These intentionally do not overlap
 * with the backend event registry in `convex/lib/analytics/events.ts`: the
 * backend captures durable CUJ events (message sent, agent created, etc.) and
 * the frontend captures UI-only signals the backend cannot see. Adding more
 * events later is cheap — extend the array, add a builder, document in
 * `docs/ANALYTICS.md`.
 *
 * PostHog convention: `[object] [verb]` lowercase with single spaces.
 */
export const FRONTEND_ANALYTICS_EVENT_NAMES = [
  "command palette item selected",
  "app error shown",
] as const;

export type FrontendAnalyticsEventName = (typeof FRONTEND_ANALYTICS_EVENT_NAMES)[number];

export type FrontendAnalyticsEvent = {
  eventName: FrontendAnalyticsEventName;
  properties: AnalyticsProperties;
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

type CommandPaletteItemKind = "channel" | "agent" | "member" | "action";

export type CommandPaletteItemSelectedInput = {
  itemKind: CommandPaletteItemKind;
  positionIndex: number;
  hasQuery: boolean;
  queryLength: number;
};

export function buildCommandPaletteItemSelectedEvent(
  input: CommandPaletteItemSelectedInput,
): FrontendAnalyticsEvent {
  return {
    eventName: "command palette item selected",
    properties: sanitizeProperties({
      item_kind: input.itemKind,
      position_index: input.positionIndex,
      has_query: input.hasQuery,
      query_length: input.queryLength,
    }),
  };
}

type AppErrorSurface = "root" | "route";
export type AppErrorKind = "network" | "render" | "convex_query" | "unknown";

export type AppErrorShownInput = {
  surface: AppErrorSurface;
  errorKind: AppErrorKind;
};

export function buildAppErrorShownEvent(input: AppErrorShownInput): FrontendAnalyticsEvent {
  return {
    eventName: "app error shown",
    properties: sanitizeProperties({
      surface: input.surface,
      error_kind: input.errorKind,
    }),
  };
}

/**
 * Bucket an arbitrary thrown value into one of the analytics-safe categories.
 * Never returns the message or stack — only a categorical label.
 *
 * `instanceof ConvexError` is the authoritative check; the `_tag` / `name`
 * heuristics catch Convex-related errors that aren't `ConvexError` instances
 * (e.g. errors thrown by Convex client transport code) so a future Convex
 * rename only loses the heuristic, not the primary gate.
 */
export function categorizeAppError(error: unknown): AppErrorKind {
  if (error == null) return "unknown";
  if (error instanceof ConvexError) return "convex_query";
  const tag = (error as { _tag?: unknown })._tag;
  if (typeof tag === "string" && tag.toLowerCase().includes("convex")) {
    return "convex_query";
  }
  const name = (error as { name?: unknown }).name;
  if (typeof name === "string" && name.toLowerCase().includes("convex")) {
    return "convex_query";
  }
  if (error instanceof TypeError) {
    const message = String((error as Error).message ?? "").toLowerCase();
    if (message.includes("fetch") || message.includes("network")) {
      return "network";
    }
  }
  if (error instanceof Error) return "render";
  return "unknown";
}
