/** Unit tests for the browser-to-runtime context budget. */

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../apps/web/src/lib/conversation";
import { buildRuntimeContext } from "../../apps/web/src/lib/runtimeContext";

function message(index: number, content: string): ChatMessage {
  return {
    id: `message-${index}`,
    branchId: "branch-root",
    role: index % 2 === 0 ? "user" : "assistant",
    content,
    createdAt: index,
  };
}

describe("runtime context", () => {
  it("takes the newest messages within count and character budgets", () => {
    const context = buildRuntimeContext(
      [message(0, "old"), message(1, "middle-long"), message(2, "newest-long")],
      undefined,
      { maxMessages: 2, maxCharacters: 12, maxMessageCharacters: 8 },
    );

    expect(context.map((item) => item.id)).toEqual(["message-1", "message-2"]);
    expect(context.reduce((total, item) => total + item.content.length, 0)).toBe(12);
    expect(context.every((item) => item.content.length <= 8)).toBe(true);
  });

  it("preserves the highlighted passage after trimming old parent messages", () => {
    const context = buildRuntimeContext(
      [message(0, "parent message"), message(1, "recent message")],
      { selectedText: "the exact highlighted claim", prompt: "" },
      { maxMessages: 1, maxCharacters: 200, maxSelectionCharacters: 100 },
    );

    expect(context.map((item) => item.id)).toEqual(["message-1", "runtime:branch-selection"]);
    expect(context.at(-1)).toMatchObject({ role: "system" });
    expect(context.at(-1)?.content).toContain("the exact highlighted claim");
  });

  it("rejects invalid budgets", () => {
    expect(() => buildRuntimeContext([], undefined, { maxMessages: 0 })).toThrow(
      "positive integers",
    );
  });
});
