/** Unit tests for Better Auth production secret safety checks. */

import { describe, expect, it } from "vitest";
import {
  assertSafeProductionBetterAuthSecret,
  isUnsafeBetterAuthSecret,
} from "../../convex/lib/authSecurity";

describe("Better Auth secret safety", () => {
  it("flags short and placeholder secrets", () => {
    expect(isUnsafeBetterAuthSecret("short")).toBe(true);
    expect(isUnsafeBetterAuthSecret("dev-change-me-please-use-a-long-random-secret")).toBe(true);
    expect(isUnsafeBetterAuthSecret("prod-placeholder-secret-with-enough-length")).toBe(true);
  });

  it("allows strong-looking development secrets and rejects unsafe production values", () => {
    expect(isUnsafeBetterAuthSecret("9JBg3Fw0HQjaB7LMbHB0FK2gEkbqK+vTR23X0xmTNtc=")).toBe(false);
    expect(() =>
      assertSafeProductionBetterAuthSecret("dev-change-me-please-use-a-long-random-secret", false),
    ).toThrow(/BETTER_AUTH_SECRET/);
    expect(() =>
      assertSafeProductionBetterAuthSecret("dev-change-me-please-use-a-long-random-secret", true),
    ).not.toThrow();
  });
});
