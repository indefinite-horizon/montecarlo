/** Browser conversation tests for immutable branch transcript snapshots. */

import { describe, expect, it } from "vitest";
import {
  type ChatBranch,
  type ChatMessage,
  nextReasoningEffort,
  visibleMessages,
} from "../../apps/web/src/lib/conversation";

function message(id: string, branchId: string, createdAt: number): ChatMessage {
  return { id, branchId, role: "user", content: id, createdAt };
}

describe("browser branch transcript", () => {
  it("does not leak parent messages written after a durable child snapshot", () => {
    const branches: ChatBranch[] = [
      {
        id: "root",
        title: "Root",
        depth: 0,
        createdAt: 1,
        messages: [message("before", "root", 2), message("after", "root", 10)],
      },
      {
        id: "child",
        parentBranchId: "root",
        contextMessageIds: ["before"],
        title: "Child",
        depth: 1,
        createdAt: 5,
        messages: [message("child-message", "child", 6)],
      },
    ];

    expect(visibleMessages(branches, "child").map((item) => item.id)).toEqual([
      "before",
      "child-message",
    ]);
    expect(visibleMessages(branches, "root").map((item) => item.id)).toEqual(["before", "after"]);
  });

  it("freezes undurable session branches at their creation time", () => {
    const branches: ChatBranch[] = [
      {
        id: "root",
        title: "Root",
        depth: 0,
        createdAt: 1,
        messages: [message("before", "root", 2), message("after", "root", 10)],
      },
      {
        id: "child",
        parentBranchId: "root",
        title: "Child",
        depth: 1,
        createdAt: 5,
        messages: [],
      },
    ];

    expect(visibleMessages(branches, "child").map((item) => item.id)).toEqual(["before"]);
  });
});

describe("reasoning effort cycling", () => {
  it("advances through every user level and wraps back to Off", () => {
    expect(nextReasoningEffort("none")).toBe("low");
    expect(nextReasoningEffort("low")).toBe("medium");
    expect(nextReasoningEffort("medium")).toBe("high");
    expect(nextReasoningEffort("high")).toBe("xhigh");
    expect(nextReasoningEffort("xhigh")).toBe("max");
    expect(nextReasoningEffort("max")).toBe("none");
  });

  it("skips unsupported levels and safely recovers an unsupported current value", () => {
    const sparseOptions = ["none", "low", "high"] as const;
    expect(nextReasoningEffort("none", sparseOptions)).toBe("low");
    expect(nextReasoningEffort("low", sparseOptions)).toBe("high");
    expect(nextReasoningEffort("high", sparseOptions)).toBe("none");
    expect(nextReasoningEffort("medium", sparseOptions)).toBe("none");
    expect(nextReasoningEffort("medium", [])).toBe("medium");
  });
});
