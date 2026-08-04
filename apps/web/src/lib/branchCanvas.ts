/** Deterministic layout and ancestry helpers for the conversation canvas. */

import { Graph, layout } from "@dagrejs/dagre";
import type { ChatBranch } from "./conversation";

export const branchCanvasConfig = {
  card: { width: 390, height: 520 },
  composer: { width: 340, height: 248 },
  handle: { size: 10 },
  layout: {
    rankSeparation: 150,
    nodeSeparation: 72,
    margin: 48,
  },
} as const;

export type CanvasPosition = { x: number; y: number };

export type BranchCanvasDraft = {
  id: string;
  parentBranchId: string;
};

export function layoutBranchCanvas(
  branches: readonly ChatBranch[],
  draft?: BranchCanvasDraft,
): Map<string, CanvasPosition> {
  const graph = new Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: branchCanvasConfig.layout.rankSeparation,
    nodesep: branchCanvasConfig.layout.nodeSeparation,
    marginx: branchCanvasConfig.layout.margin,
    marginy: branchCanvasConfig.layout.margin,
    ranker: "network-simplex",
  });

  const branchIds = new Set(branches.map((branch) => branch.id));
  const orderedBranches = [...branches].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  for (const branch of orderedBranches) {
    graph.setNode(branch.id, {
      width: branchCanvasConfig.card.width,
      height: branchCanvasConfig.card.height,
    });
  }
  if (draft && branchIds.has(draft.parentBranchId)) {
    graph.setNode(draft.id, {
      width: branchCanvasConfig.composer.width,
      height: branchCanvasConfig.composer.height,
    });
  }
  for (const branch of orderedBranches) {
    if (branch.parentBranchId && branchIds.has(branch.parentBranchId)) {
      graph.setEdge(branch.parentBranchId, branch.id);
    }
  }
  if (draft && branchIds.has(draft.parentBranchId)) {
    graph.setEdge(draft.parentBranchId, draft.id);
  }

  layout(graph);

  const positions = new Map(
    orderedBranches.map((branch) => {
      const node = graph.node(branch.id);
      return [
        branch.id,
        {
          x: node.x - branchCanvasConfig.card.width / 2,
          y: node.y - branchCanvasConfig.card.height / 2,
        },
      ];
    }),
  );
  if (draft && graph.hasNode(draft.id)) {
    const node = graph.node(draft.id);
    positions.set(draft.id, {
      x: node.x - branchCanvasConfig.composer.width / 2,
      y: node.y - branchCanvasConfig.composer.height / 2,
    });
  }
  return positions;
}

export function branchAncestryIds(
  branches: readonly ChatBranch[],
  branchId: string | undefined,
): Set<string> {
  if (!branchId) return new Set();
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const ancestry = new Set<string>();
  let cursor = byId.get(branchId);

  while (cursor && !ancestry.has(cursor.id)) {
    ancestry.add(cursor.id);
    cursor = cursor.parentBranchId ? byId.get(cursor.parentBranchId) : undefined;
  }
  return ancestry;
}
