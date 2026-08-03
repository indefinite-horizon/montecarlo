/** PostHog browser SDK adapter. The only file allowed to import `posthog-js`. */

import posthog from "posthog-js";
import type { AnalyticsProvider } from "./provider";
import { scrubSensitiveUrlParams } from "./urlScrub";

export type PostHogAdapterConfig = {
  projectToken: string;
  host: string;
};

// PostHog's init() is not idempotent across configs: a second call with a
// different token would be silently ignored. Production code only ever
// resolves the adapter once via context.tsx's initRef guard, so this flag is
// just defense-in-depth for tests or future callers that might construct the
// adapter twice.
let initialized = false;

export function createPostHogAnalyticsAdapter(config: PostHogAdapterConfig): AnalyticsProvider {
  if (!initialized) {
    posthog.init(config.projectToken, {
      api_host: config.host,
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
        // `[contenteditable]:not([contenteditable='false'])` covers the boolean
        // form `<div contenteditable>` (equivalent to `="true"`) which the
        // exact `[contenteditable='true']` selector would miss.
        maskTextSelector: [
          "[data-ph-mask]",
          ".ProseMirror",
          "[contenteditable]:not([contenteditable='false'])",
          "[role='textbox']",
          ".markdown-message",
        ].join(", "),
        blockSelector: "[data-ph-block]",
        recordCrossOriginIframes: false,
      },
      sanitize_properties: (properties) =>
        scrubSensitiveUrlParams(properties as Record<string, unknown>),
      persistence: "localStorage+cookie",
    });
    initialized = true;
  }

  return {
    identify(distinctId, props) {
      posthog.identify(distinctId, props);
    },
    group(groupType, groupKey) {
      posthog.group(groupType, groupKey);
    },
    reset() {
      posthog.reset();
    },
    capture(eventName, props) {
      posthog.capture(eventName, props);
    },
  };
}
