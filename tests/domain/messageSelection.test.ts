/** Protects source-backed selections across fully hydrated messages. */

import { describe, expect, it } from "vitest";
import { selectionTextWithinMessage } from "../../apps/web/src/lib/messageSelection";
import { selectionMatchesStoredMessage } from "../../convex/lib/domainValidation";

describe("selectionTextWithinMessage", () => {
  it("accepts only an exact source-backed selection", () => {
    const content = "A precise highlighted passage";

    expect(selectionTextWithinMessage(content, 2, "precise")).toBe("precise");
    expect(selectionTextWithinMessage(content, 2, "imprecise")).toBeUndefined();
    expect(selectionTextWithinMessage(content, 2, "pr")).toBe("pr");
    expect(selectionTextWithinMessage(content, 2, "p")).toBe("p");
    expect(selectionTextWithinMessage(content, 2, "")).toBeUndefined();
  });

  it("accepts exact selections anywhere in hydrated message content", () => {
    const content = `${"a".repeat(1_216)}reef framework`;

    expect(selectionTextWithinMessage(content, 1_216, "reef framework")).toBe("reef framework");
  });
});

describe("selectionMatchesStoredMessage", () => {
  const sourceMessage = { contentPreview: "a".repeat(1_000), byteLength: 2_000 };

  it("validates selections against every available preview character", () => {
    expect(
      selectionMatchesStoredMessage(
        { start: 995, end: 1_005, quote: `${"a".repeat(5)}later` },
        sourceMessage,
      ),
    ).toBe(true);
    expect(
      selectionMatchesStoredMessage(
        { start: 995, end: 1_005, quote: `wrong${"a".repeat(5)}` },
        sourceMessage,
      ),
    ).toBe(false);
  });

  it("accepts well-shaped selections in the integrity-checked hydrated tail", () => {
    expect(
      selectionMatchesStoredMessage(
        { start: 1_216, end: 1_230, quote: "reef framework" },
        sourceMessage,
      ),
    ).toBe(true);
    expect(
      selectionMatchesStoredMessage(
        { start: 1_216, end: 1_229, quote: "reef framework" },
        sourceMessage,
      ),
    ).toBe(false);
    expect(
      selectionMatchesStoredMessage(
        { start: 1_216.5, end: 1_230.5, quote: "reef framework" },
        sourceMessage,
      ),
    ).toBe(false);
    expect(
      selectionMatchesStoredMessage(
        { start: 1_990, end: 2_004, quote: "reef framework" },
        sourceMessage,
      ),
    ).toBe(false);
  });
});
