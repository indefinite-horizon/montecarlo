/** Analytics provider interface. PostHog and no-op adapters both satisfy this shape. */

import type { AnalyticsProperties } from "../../../../../lib/analytics/sanitize";
import type { FrontendAnalyticsEventName } from "./events";

/**
 * Provider-agnostic analytics surface. The web app only ever depends on this
 * interface — the concrete `posthog-js` import lives behind `posthogAdapter.ts`.
 *
 * Pageviews are emitted by the underlying SDK (PostHog autocapture); this
 * interface intentionally has no `pageview()` method.
 */
export interface AnalyticsProvider {
  /** Tag the current session with a stable user id and safe user properties. */
  identify(distinctId: string, props?: AnalyticsProperties): void;
  /** Associate the current session with a workspace group. */
  group(groupType: "workspace", groupKey: string): void;
  /** Drop identification + recording session; called on sign-out. */
  reset(): void;
  /** Capture a typed event. Properties are pre-sanitized by the builder. */
  capture(eventName: FrontendAnalyticsEventName, props: AnalyticsProperties): void;
}
