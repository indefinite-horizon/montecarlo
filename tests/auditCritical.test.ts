/** Protects the high-severity dependency-audit threshold and failure handling. */

import { describe, expect, it } from "vitest";
import { evaluateRootAudit } from "../scripts/audit-critical";

describe("critical dependency audit", () => {
  it("allows a nonzero Bun exit when the complete report only contains lower severities", () => {
    expect(
      evaluateRootAudit(
        JSON.stringify({
          example: [
            {
              severity: "moderate",
              title: "Moderate example",
              url: "https://example.test/advisory",
            },
          ],
        }),
        1,
        "bun audit v1.3.6",
      ),
    ).toEqual([]);
  });

  it("blocks high and critical advisories from a complete report", () => {
    expect(
      evaluateRootAudit(
        JSON.stringify({
          vulnerable: [
            {
              severity: "high",
              title: "High example",
              url: "https://example.test/high",
            },
            {
              severity: "critical",
              title: "Critical example",
              url: "https://example.test/critical",
            },
          ],
        }),
        1,
        "",
      ),
    ).toEqual([
      "vulnerable: High example (https://example.test/high)",
      "vulnerable: Critical example (https://example.test/critical)",
    ]);
  });

  it("still rejects a failed audit with no advisory report", () => {
    expect(() => evaluateRootAudit("{}", 1, "registry unavailable")).toThrow(
      "bun audit failed: registry unavailable",
    );
  });

  it("rejects unexpected registry JSON instead of treating it as a clean report", () => {
    expect(() => evaluateRootAudit('{"error":"registry unavailable"}', 1, "")).toThrow(
      "bun audit emitted an unexpected JSON report",
    );
  });
});
