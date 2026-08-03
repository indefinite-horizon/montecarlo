/** Unit tests for the destructive local dev-tools gate. */

import { describe, expect, it } from "vitest";
import { computeDevToolsEnabled } from "../../convex/lib/devToolsGate";

describe("dev tools gate", () => {
  it("requires a local site URL and the explicit opt-in flag", () => {
    expect(computeDevToolsEnabled("http://localhost:5173", "true")).toBe(true);
    expect(computeDevToolsEnabled("http://127.0.0.1:5173", "true")).toBe(true);
    expect(computeDevToolsEnabled("http://0.0.0.0:5173", "true")).toBe(false);
    expect(computeDevToolsEnabled("https://example.com", "true")).toBe(false);
    expect(computeDevToolsEnabled("http://localhost:5173", "")).toBe(false);
    expect(computeDevToolsEnabled("http://localhost:5173", "TRUE")).toBe(false);
  });
});
