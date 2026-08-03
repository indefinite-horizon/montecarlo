/** Unit tests for deterministic branch tree construction and traversal. */

import { describe, expect, it } from "vitest";
import {
  type BranchId,
  type BranchTreeError,
  buildBranchTree,
  type ChatBranch,
  domainId,
  flattenBranchTree,
  getBranchPath,
  getDescendantBranchIds,
} from "../../components/domain/src";

const workspaceId = domainId<"workspace">("workspace-tree");
const chatId = domainId<"chat">("chat-tree");
const anchorMessageId = domainId<"message">("message-anchor");

function makeBranch(idValue: string, parentBranchId?: BranchId, createdAt = 1): ChatBranch {
  const id = domainId<"branch">(idValue);
  return {
    id,
    workspaceId,
    chatId,
    parentBranchId,
    origin:
      parentBranchId === undefined
        ? { type: "root" }
        : { type: "prompt", anchorMessageId, prompt: `Explore ${idValue}` },
    createdAt,
  };
}

describe("branch tree", () => {
  it("orders siblings and traversals deterministically regardless of input order", () => {
    const root = makeBranch("branch-root");
    const later = makeBranch("branch-later", root.id, 30);
    const sameTimeZ = makeBranch("branch-z", root.id, 20);
    const sameTimeA = makeBranch("branch-a", root.id, 20);
    const grandchild = makeBranch("branch-grandchild", sameTimeA.id, 21);

    const tree = buildBranchTree([later, grandchild, sameTimeZ, root, sameTimeA], root.id);

    expect(tree.root.children.map((node) => node.branch.id)).toEqual([
      sameTimeA.id,
      sameTimeZ.id,
      later.id,
    ]);
    expect(flattenBranchTree(tree).map((branch) => branch.id)).toEqual([
      root.id,
      sameTimeA.id,
      grandchild.id,
      sameTimeZ.id,
      later.id,
    ]);
    expect(getBranchPath(tree, grandchild.id).map((branch) => branch.id)).toEqual([
      root.id,
      sameTimeA.id,
      grandchild.id,
    ]);
    expect(getDescendantBranchIds(tree, sameTimeA.id, true)).toEqual([sameTimeA.id, grandchild.id]);
  });

  it("reports a missing parent before attempting to select a root", () => {
    const missingParent = domainId<"branch">("branch-missing");
    const child = makeBranch("branch-child", missingParent);

    expect(() => buildBranchTree([child])).toThrowError(
      expect.objectContaining<Partial<BranchTreeError>>({ code: "missing_parent" }),
    );
  });

  it("detects parent cycles precisely", () => {
    const firstId = domainId<"branch">("branch-first");
    const secondId = domainId<"branch">("branch-second");
    const first = makeBranch(String(firstId), secondId);
    const second = makeBranch(String(secondId), firstId);

    expect(() => buildBranchTree([first, second])).toThrowError(
      expect.objectContaining<Partial<BranchTreeError>>({ code: "cycle" }),
    );
  });

  it("rejects duplicate IDs and multiple roots", () => {
    const root = makeBranch("branch-root");
    expect(() => buildBranchTree([root, { ...root }])).toThrowError(
      expect.objectContaining<Partial<BranchTreeError>>({ code: "duplicate_branch" }),
    );
    expect(() => buildBranchTree([root, makeBranch("branch-other-root")])).toThrowError(
      expect.objectContaining<Partial<BranchTreeError>>({ code: "multiple_roots" }),
    );
  });
});
