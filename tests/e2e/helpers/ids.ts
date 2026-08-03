/** Stable id helpers for Playwright specs. */

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@test.local`;
}
