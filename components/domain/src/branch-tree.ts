/** Builds and traverses deterministic chat branch trees with invariant checks. */

import type { BranchId, ChatBranch } from "./types";

export type BranchTreeErrorCode =
  | "empty_tree"
  | "duplicate_branch"
  | "invalid_branch"
  | "missing_parent"
  | "cross_chat_parent"
  | "invalid_root"
  | "multiple_roots"
  | "cycle"
  | "disconnected_branch"
  | "branch_not_found";

export class BranchTreeError extends Error {
  readonly code: BranchTreeErrorCode;
  readonly branchId?: BranchId;

  constructor(code: BranchTreeErrorCode, message: string, branchId?: BranchId) {
    super(message);
    this.name = "BranchTreeError";
    this.code = code;
    this.branchId = branchId;
  }
}

export interface BranchTreeNode {
  branch: ChatBranch;
  children: readonly BranchTreeNode[];
}

export interface BranchTree {
  root: BranchTreeNode;
  byId: ReadonlyMap<BranchId, BranchTreeNode>;
}

function compareBranches(left: ChatBranch, right: ChatBranch): number {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  return String(left.id).localeCompare(String(right.id));
}

function validateBranchOrigin(branch: ChatBranch): void {
  const isRoot = branch.parentBranchId === undefined;
  if (isRoot && branch.origin.type !== "root") {
    throw new BranchTreeError(
      "invalid_branch",
      `Root branch '${branch.id}' must have a root origin`,
      branch.id,
    );
  }
  if (!isRoot && branch.origin.type === "root") {
    throw new BranchTreeError(
      "invalid_branch",
      `Child branch '${branch.id}' must have a prompt or selection origin`,
      branch.id,
    );
  }
  if (!Number.isFinite(branch.createdAt) || branch.createdAt < 0) {
    throw new BranchTreeError(
      "invalid_branch",
      `Branch '${branch.id}' has an invalid createdAt timestamp`,
      branch.id,
    );
  }
}

function assertAcyclic(branchesById: ReadonlyMap<BranchId, ChatBranch>): void {
  const state = new Map<BranchId, "visiting" | "visited">();

  const visit = (branch: ChatBranch): void => {
    const currentState = state.get(branch.id);
    if (currentState === "visited") return;
    if (currentState === "visiting") {
      throw new BranchTreeError(
        "cycle",
        `Branch '${branch.id}' participates in a parent cycle`,
        branch.id,
      );
    }

    state.set(branch.id, "visiting");
    if (branch.parentBranchId !== undefined) {
      const parent = branchesById.get(branch.parentBranchId);
      if (parent) visit(parent);
    }
    state.set(branch.id, "visited");
  };

  for (const branch of branchesById.values()) visit(branch);
}

/** Builds one validated tree, sorting siblings by creation time and then stable ID. */
export function buildBranchTree(
  branches: readonly ChatBranch[],
  requestedRootId?: BranchId,
): BranchTree {
  if (branches.length === 0) {
    throw new BranchTreeError("empty_tree", "A branch tree requires at least one branch");
  }

  const branchesById = new Map<BranchId, ChatBranch>();
  const first = branches[0];
  if (!first) {
    throw new BranchTreeError("empty_tree", "A branch tree requires at least one branch");
  }

  for (const branch of branches) {
    validateBranchOrigin(branch);
    if (branchesById.has(branch.id)) {
      throw new BranchTreeError(
        "duplicate_branch",
        `Branch ID '${branch.id}' appears more than once`,
        branch.id,
      );
    }
    if (branch.chatId !== first.chatId || branch.workspaceId !== first.workspaceId) {
      throw new BranchTreeError(
        "invalid_branch",
        `Branch '${branch.id}' belongs to a different chat or workspace`,
        branch.id,
      );
    }
    branchesById.set(branch.id, branch);
  }

  const childrenByParent = new Map<BranchId, ChatBranch[]>();
  for (const branch of branches) {
    const parentId = branch.parentBranchId;
    if (parentId === undefined) continue;
    const parent = branchesById.get(parentId);
    if (!parent) {
      throw new BranchTreeError(
        "missing_parent",
        `Branch '${branch.id}' references missing parent '${parentId}'`,
        branch.id,
      );
    }
    if (parent.chatId !== branch.chatId || parent.workspaceId !== branch.workspaceId) {
      throw new BranchTreeError(
        "cross_chat_parent",
        `Branch '${branch.id}' references a parent outside its chat`,
        branch.id,
      );
    }
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(branch);
    childrenByParent.set(parentId, siblings);
  }

  assertAcyclic(branchesById);

  const roots = branches
    .filter((branch) => branch.parentBranchId === undefined)
    .sort(compareBranches);
  if (roots.length !== 1) {
    throw new BranchTreeError(
      "multiple_roots",
      `Expected exactly one root branch, received ${roots.length}`,
    );
  }

  const root = roots[0];
  if (!root) {
    throw new BranchTreeError("invalid_root", "The branch tree does not have a root");
  }
  if (requestedRootId !== undefined && root.id !== requestedRootId) {
    throw new BranchTreeError(
      "invalid_root",
      `Expected root '${requestedRootId}', received '${root.id}'`,
      requestedRootId,
    );
  }

  for (const siblings of childrenByParent.values()) siblings.sort(compareBranches);

  const nodesById = new Map<BranchId, BranchTreeNode>();
  const buildNode = (branch: ChatBranch): BranchTreeNode => {
    const children = (childrenByParent.get(branch.id) ?? []).map(buildNode);
    const node: BranchTreeNode = { branch, children };
    nodesById.set(branch.id, node);
    return node;
  };
  const rootNode = buildNode(root);

  if (nodesById.size !== branches.length) {
    const disconnected = branches.find((branch) => !nodesById.has(branch.id));
    throw new BranchTreeError(
      "disconnected_branch",
      `Branch '${disconnected?.id ?? "unknown"}' is disconnected from the root`,
      disconnected?.id,
    );
  }

  return { root: rootNode, byId: nodesById };
}

/** Returns the root-to-target path for a branch in a previously validated tree. */
export function getBranchPath(tree: BranchTree, targetId: BranchId): readonly ChatBranch[] {
  const target = tree.byId.get(targetId);
  if (!target) {
    throw new BranchTreeError(
      "branch_not_found",
      `Branch '${targetId}' is not in this tree`,
      targetId,
    );
  }

  const path: ChatBranch[] = [];
  let current: ChatBranch | undefined = target.branch;
  while (current) {
    path.push(current);
    current =
      current.parentBranchId === undefined
        ? undefined
        : tree.byId.get(current.parentBranchId)?.branch;
  }
  path.reverse();
  return path;
}

/** Flattens a tree in deterministic pre-order. */
export function flattenBranchTree(tree: BranchTree): readonly ChatBranch[] {
  const result: ChatBranch[] = [];
  const visit = (node: BranchTreeNode): void => {
    result.push(node.branch);
    for (const child of node.children) visit(child);
  };
  visit(tree.root);
  return result;
}

/** Returns descendants in deterministic pre-order, optionally including the target branch. */
export function getDescendantBranchIds(
  tree: BranchTree,
  targetId: BranchId,
  includeTarget = false,
): readonly BranchId[] {
  const target = tree.byId.get(targetId);
  if (!target) {
    throw new BranchTreeError(
      "branch_not_found",
      `Branch '${targetId}' is not in this tree`,
      targetId,
    );
  }

  const result: BranchId[] = [];
  const visit = (node: BranchTreeNode): void => {
    result.push(node.branch.id);
    for (const child of node.children) visit(child);
  };
  if (includeTarget) visit(target);
  else for (const child of target.children) visit(child);
  return result;
}
