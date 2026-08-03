/** No-op analytics adapter used when the provider is disabled or unconfigured. */

import type { AnalyticsProvider } from "./provider";

export function createNoopAnalyticsAdapter(): AnalyticsProvider {
  return {
    identify() {},
    group() {},
    reset() {},
    capture() {},
  };
}
