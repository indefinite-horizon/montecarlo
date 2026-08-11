/** Browser conversation tests for immutable branch transcript snapshots. */

import { describe, expect, it } from "vitest";
import {
  type ChatBranch,
  type ChatMessage,
  hasStreamingMessage,
  isThreadOpeningContentReady,
  nextReasoningEffort,
  visibleMessages,
} from "../../apps/web/src/lib/conversation";

function message(id: string, branchId: string, createdAt: number): ChatMessage {
  return { id, branchId, role: "user", content: id, createdAt };
}

describe("browser branch transcript", () => {
  it("detects response activity outside the visible branch", () => {
    const branches: ChatBranch[] = [
      {
        id: "root",
        title: "Root",
        depth: 0,
        createdAt: 1,
        messages: [message("settled", "root", 2)],
      },
      {
        id: "child",
        parentBranchId: "root",
        title: "Child",
        depth: 1,
        createdAt: 3,
        messages: [{ ...message("streaming", "child", 4), isStreaming: true }],
      },
    ];

    expect(hasStreamingMessage(branches)).toBe(true);
    expect(hasStreamingMessage([{ ...branches[0], messages: [] } as ChatBranch])).toBe(false);
  });

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

describe("thread opening content", () => {
  it("waits for the latest anchored turn without blocking on older messages", () => {
    const messages = [
      { ...message("old-user", "root", 1), contentReady: false },
      {
        ...message("old-assistant", "root", 2),
        role: "assistant" as const,
        contentReady: false,
      },
      { ...message("latest-user", "root", 3), contentReady: true },
      {
        ...message("latest-assistant", "root", 4),
        role: "assistant" as const,
        contentReady: true,
      },
    ];

    expect(isThreadOpeningContentReady(messages)).toBe(true);
    messages[3] = { ...messages[3], contentReady: false };
    expect(isThreadOpeningContentReady(messages)).toBe(false);
  });
});
