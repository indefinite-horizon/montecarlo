/** Canvas topology and layout remain deterministic as branch content changes. */

import { describe, expect, it } from "vitest";
import {
  branchAncestryIds,
  branchCanvasConfig,
  layoutBranchCanvas,
} from "../../apps/web/src/lib/branchCanvas";
import type { ChatBranch } from "../../apps/web/src/lib/conversation";

function branch(
  id: string,
  parentBranchId: string | undefined,
  depth: number,
  createdAt: number,
): ChatBranch {
  return {
    id,
    parentBranchId,
    depth,
    createdAt,
    title: id,
    messages: [],
  };
}

describe("branch canvas", () => {
  const branches = [
    branch("root", undefined, 0, 1),
    branch("child-a", "root", 1, 2),
    branch("child-b", "root", 1, 3),
    branch("grandchild", "child-a", 2, 4),
  ];

  it("lays out descendants left to right and separates siblings", () => {
    const positions = layoutBranchCanvas(branches);
    const root = positions.get("root");
    const childA = positions.get("child-a");
    const childB = positions.get("child-b");
    const grandchild = positions.get("grandchild");

    expect(root).toBeDefined();
    expect(childA?.x).toBeGreaterThan((root?.x ?? 0) + branchCanvasConfig.card.width);
    expect(grandchild?.x).toBeGreaterThan((childA?.x ?? 0) + branchCanvasConfig.card.width);
    expect(childA?.y).not.toBe(childB?.y);
  });

  it("returns only the hovered branch ancestry", () => {
    expect([...branchAncestryIds(branches, "grandchild")]).toEqual([
      "grandchild",
      "child-a",
      "root",
    ]);
    expect([...branchAncestryIds(branches, "child-b")]).toEqual(["child-b", "root"]);
  });

  it("lays out a draft follow-up without overlapping sibling branches", () => {
    const draftId = "follow-up-root";
    const positions = layoutBranchCanvas(branches, {
      id: draftId,
      parentBranchId: "root",
    });
    const draft = positions.get(draftId);

    expect(draft).toBeDefined();
    for (const childId of ["child-a", "child-b"]) {
      const child = positions.get(childId);
      expect(child).toBeDefined();
      const separatedVertically =
        (draft?.y ?? 0) + branchCanvasConfig.composer.height <= (child?.y ?? 0) ||
        (child?.y ?? 0) + branchCanvasConfig.card.height <= (draft?.y ?? 0);
      expect(separatedVertically).toBe(true);
    }
  });

  it("stops safely when malformed input contains a cycle", () => {
    const cyclic = [branch("a", "b", 1, 1), branch("b", "a", 2, 2)];
    expect([...branchAncestryIds(cyclic, "a")]).toEqual(["a", "b"]);
  });
});
