/** Browser conversation tests for immutable branch transcript snapshots. */

import { describe, expect, it } from "vitest";
import type { ChatBranch, ChatMessage } from "../../apps/web/src/lib/conversation";
import { visibleMessages } from "../../apps/web/src/lib/conversation";

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
