/** Protects the high-severity dependency-audit threshold and failure handling. */

import { describe, expect, it } from "vitest";
import { evaluateRootAudit } from "../scripts/audit-critical";

describe("critical dependency audit", () => {
  it("allows a filtered report that contains only lower severities", () => {
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
      ),
    ).toEqual([
      "vulnerable: High example (https://example.test/high)",
      "vulnerable: Critical example (https://example.test/critical)",
    ]);
  });

  it("allows an empty high-severity report", () => {
    expect(evaluateRootAudit("{}")).toEqual([]);
  });

  it("rejects unexpected registry JSON instead of treating it as a clean report", () => {
    expect(() => evaluateRootAudit('{"error":"registry unavailable"}')).toThrow(
      "bun audit emitted an unexpected JSON report",
    );
  });
});
