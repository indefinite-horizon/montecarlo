/** Browser conversation tests for immutable branch transcript snapshots. */

import { describe, expect, it } from "vitest";
import {
  branchSubtreeIds,
  type ChatBranch,
  type ChatMessage,
  childBranchesBySourceMessage,
  hasRunningBranchInSubtree,
  hasStreamingMessage,
  isBranchRunning,
  isThreadOpeningContentReady,
  nextReasoningEffort,
  runningBranchIds,
  visibleMessages,
} from "../../apps/web/src/lib/conversation";

function message(id: string, branchId: string, createdAt: number): ChatMessage {
  return { id, branchId, role: "user", content: id, createdAt };
}

describe("browser branch transcript", () => {
  it("groups direct children at their source turn and orders sibling callouts", () => {
    const branches: ChatBranch[] = [
      { id: "root", title: "Root", depth: 0, createdAt: 1, messages: [] },
      {
        id: "later",
        parentBranchId: "root",
        contextMessageIds: ["turn"],
        title: "Later",
        depth: 1,
        createdAt: 4,
        messages: [],
      },
      {
        id: "earlier",
        parentBranchId: "root",
        contextMessageIds: ["turn"],
        title: "Earlier",
        depth: 1,
        createdAt: 3,
        messages: [],
      },
      {
        id: "grandchild",
        parentBranchId: "earlier",
        contextMessageIds: ["turn"],
        title: "Grandchild",
        depth: 2,
        createdAt: 5,
        messages: [],
      },
    ];

    expect(
      childBranchesBySourceMessage(branches, "root")
        .get("turn")
        ?.map(({ id }) => id),
    ).toEqual(["earlier", "later"]);
  });

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

  it("tracks response activity independently for each branch", () => {
    const now = 1_000;
    const branches: ChatBranch[] = [
      {
        id: "root",
        title: "Root",
        depth: 0,
        createdAt: 1,
        messages: [{ ...message("persisted-running", "root", 2), runStatus: "running" }],
      },
      {
        id: "streaming-sibling",
        parentBranchId: "root",
        title: "Streaming sibling",
        depth: 1,
        createdAt: 3,
        messages: [{ ...message("optimistic-running", "streaming-sibling", 4), isStreaming: true }],
      },
      {
        id: "settled-sibling",
        parentBranchId: "root",
        title: "Settled sibling",
        depth: 1,
        createdAt: 5,
        messages: [{ ...message("settled", "settled-sibling", 6), runStatus: "succeeded" }],
      },
      {
        id: "leased-sibling",
        activeRunId: "run-leased",
        activeRunLeaseExpiresAt: now + 1,
        parentBranchId: "root",
        title: "Leased sibling",
        depth: 1,
        createdAt: 7,
        messages: [],
      },
      {
        id: "expired-sibling",
        activeRunId: "run-expired",
        activeRunLeaseExpiresAt: now,
        parentBranchId: "root",
        title: "Expired sibling",
        depth: 1,
        createdAt: 8,
        messages: [{ ...message("stale-running", "expired-sibling", 9), runStatus: "running" }],
      },
    ];

    expect(isBranchRunning(branches[0], now)).toBe(true);
    expect(isBranchRunning(branches[1], now)).toBe(true);
    expect(isBranchRunning(branches[2], now)).toBe(false);
    expect(isBranchRunning(branches[3], now)).toBe(true);
    expect(isBranchRunning(branches[4], now)).toBe(false);
    expect([...runningBranchIds(branches, now)]).toEqual([
      "root",
      "streaming-sibling",
      "leased-sibling",
    ]);
  });

  it("scopes dependent activity to the target branch and its descendants", () => {
    const branches: ChatBranch[] = [
      {
        id: "root",
        title: "Root",
        depth: 0,
        createdAt: 1,
        messages: [],
      },
      {
        id: "target",
        parentBranchId: "root",
        title: "Target",
        depth: 1,
        createdAt: 2,
        messages: [],
      },
      {
        id: "descendant",
        parentBranchId: "target",
        title: "Descendant",
        depth: 2,
        createdAt: 3,
        messages: [{ ...message("running", "descendant", 4), isStreaming: true }],
      },
      {
        id: "sibling",
        parentBranchId: "root",
        title: "Sibling",
        depth: 1,
        createdAt: 5,
        messages: [{ ...message("sibling-running", "sibling", 6), isStreaming: true }],
      },
    ];

    expect([...branchSubtreeIds(branches, "target")]).toEqual(["target", "descendant"]);
    expect(hasRunningBranchInSubtree(branches, "target")).toBe(true);
    expect(hasRunningBranchInSubtree(branches, "descendant")).toBe(true);
    expect(hasRunningBranchInSubtree(branches, "sibling")).toBe(true);

    const settledDescendant = branches.map((branch) =>
      branch.id === "descendant"
        ? { ...branch, messages: branch.messages.map((item) => ({ ...item, isStreaming: false })) }
        : branch,
    );
    expect(hasRunningBranchInSubtree(settledDescendant, "target")).toBe(false);
    expect(hasRunningBranchInSubtree(settledDescendant, "root")).toBe(true);

    const runningTarget = settledDescendant.map((branch) =>
      branch.id === "target"
        ? {
            ...branch,
            messages: [
              { ...message("target-running", "target", 7), runStatus: "running" as const },
            ],
          }
        : branch,
    );
    expect(hasRunningBranchInSubtree(runningTarget, "target")).toBe(true);
    expect(hasRunningBranchInSubtree(runningTarget, "descendant")).toBe(false);
    expect(branchSubtreeIds(branches, "missing").size).toBe(0);
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
