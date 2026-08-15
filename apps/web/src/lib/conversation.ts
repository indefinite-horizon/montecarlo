/** Browser-facing conversation view models for the provider-neutral chat shell. */

export type ProviderId = "codex" | "anthropic" | "ollama" | "openrouter";

export const reasoningEfforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export const fallbackReasoningEfforts = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
] as const satisfies readonly ReasoningEffort[];
export const userReasoningEfforts = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ReasoningEffort[];

export function nextReasoningEffort(
  current: ReasoningEffort,
  options: readonly ReasoningEffort[] = userReasoningEfforts,
): ReasoningEffort {
  if (options.length === 0) return current;
  const currentIndex = options.indexOf(current);
  return options[(currentIndex + 1) % options.length] ?? options[0] ?? current;
}

export type ChatMessage = {
  id: string;
  /** Stable portable identity used for UI state across optimistic persistence. */
  publicId?: string;
  /** Whether the message has crossed the durable persistence boundary. */
  persisted?: boolean;
  branchId: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Whether persisted content resolution settled, including preview fallback. */
  contentReady?: boolean;
  createdAt: number;
  provider?: ProviderId;
  model?: string;
  runStatus?: "running" | "succeeded" | "failed" | "canceled";
  isStreaming?: boolean;
  isError?: boolean;
};

export function messageScrollId(message: ChatMessage): string {
  return message.publicId ?? message.id;
}

export function isThreadOpeningContentReady(messages: ChatMessage[]): boolean {
  let latestAnchorIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestAnchorIndex = index;
      break;
    }
  }
  const openingTurnIndex = latestAnchorIndex >= 0 ? latestAnchorIndex : messages.length - 1;
  return messages
    .slice(Math.max(0, openingTurnIndex))
    .every((message) => message.contentReady !== false);
}

export type BranchAnchor = {
  sourceMessageId?: string;
  /** Exact source slice used to validate stable selection offsets. */
  selectedText?: string;
  /** Rendered text shown to the user and supplied as branch context. */
  displayText?: string;
  selectionStart?: number;
  selectionEnd?: number;
  prompt: string;
};

export type ChatBranch = {
  id: string;
  /** Stable portable identity used at browser and persistence boundaries. */
  publicId?: string;
  /** Durable branch-local run identity, guarded by an expiring lease. */
  activeRunId?: string;
  activeRunLeaseExpiresAt?: number;
  parentBranchId?: string;
  /** Immutable ancestor message snapshot captured when this branch is created. */
  contextMessageIds?: string[];
  title: string;
  isUnread?: boolean;
  depth: number;
  createdAt: number;
  anchor?: BranchAnchor;
  messages: ChatMessage[];
  /** Whether this branch has enough settled content for its initial scroll anchor. */
  openingContentReady?: boolean;
};

export function hasStreamingMessage(branches: readonly ChatBranch[]): boolean {
  return branches.some((branch) => branch.messages.some((message) => message.isStreaming));
}

/** Includes optimistic streams, durable leases, and legacy pre-lease running messages. */
export function isBranchRunning(branch: ChatBranch | undefined, now = Date.now()): boolean {
  if (!branch) return false;
  if (branch.messages.some((message) => message.isStreaming)) return true;

  const hasLeaseMetadata =
    branch.activeRunId !== undefined || branch.activeRunLeaseExpiresAt !== undefined;
  if (hasLeaseMetadata) {
    return (
      branch.activeRunId !== undefined &&
      branch.activeRunLeaseExpiresAt !== undefined &&
      branch.activeRunLeaseExpiresAt > now
    );
  }

  return branch.messages.some((message) => message.runStatus === "running");
}

export function runningBranchIds(
  branches: readonly ChatBranch[],
  now = Date.now(),
): ReadonlySet<string> {
  return new Set(
    branches.filter((branch) => isBranchRunning(branch, now)).map((branch) => branch.id),
  );
}

/** Returns the target branch and every branch that transitively descends from it. */
export function branchSubtreeIds(
  branches: readonly ChatBranch[],
  targetBranchId: string,
): ReadonlySet<string> {
  if (!branches.some((branch) => branch.id === targetBranchId)) return new Set();

  const childrenByParentId = new Map<string, string[]>();
  for (const branch of branches) {
    if (!branch.parentBranchId) continue;
    const children = childrenByParentId.get(branch.parentBranchId) ?? [];
    children.push(branch.id);
    childrenByParentId.set(branch.parentBranchId, children);
  }

  const subtree = new Set<string>();
  const pending = [targetBranchId];
  while (pending.length > 0) {
    const branchId = pending.pop();
    if (!branchId || subtree.has(branchId)) continue;
    subtree.add(branchId);
    pending.push(...(childrenByParentId.get(branchId) ?? []));
  }
  return subtree;
}

/** Whether a target branch or one of its descendants currently owns an active response. */
export function hasRunningBranchInSubtree(
  branches: readonly ChatBranch[],
  targetBranchId: string,
  now = Date.now(),
): boolean {
  const subtree = branchSubtreeIds(branches, targetBranchId);
  return branches.some((branch) => subtree.has(branch.id) && isBranchRunning(branch, now));
}

export type ChatSummary = {
  id: string;
  /** Stable portable identity used at browser and persistence boundaries. */
  publicId?: string;
  /** Stable portable identity of the chat's root branch. */
  rootBranchPublicId?: string;
  projectId?: string;
  title: string;
  updatedAt: number;
  /** Recency key for sidebar ordering; only user messages advance it. */
  lastUserMessageAt: number;
  branchCount: number;
  /** Stable identity of the latest fully completed message across every branch. */
  latestCompletedMessagePublicId?: string;
  isUnread: boolean;
  isPinned: boolean;
  pinnedAt?: number;
  /** Session-owned response activity; intentionally resets after reload. */
  hasOngoingResponse: boolean;
};

export type ProjectSummary = {
  id: string;
  /** Stable portable identity used at browser and persistence boundaries. */
  publicId?: string;
  name: string;
  color: string;
};

export type SelectionAnchor = {
  messageId: string;
  /** Rendered text selected by the user. */
  text: string;
  /** Exact Markdown source slice corresponding to the selected range. */
  sourceText?: string;
  start: number;
  end: number;
  rect: { top: number; left: number; width: number; height: number };
};

export type ProviderOption = {
  id: ProviderId;
  label: string;
  model: string;
  detail: string;
  availability: "ready" | "setup" | "blocked";
};

export function branchLineage(branches: ChatBranch[], activeBranchId: string): ChatBranch[] {
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const lineage: ChatBranch[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(activeBranchId);

  while (cursor) {
    if (seen.has(cursor.id)) throw new Error("Branch graph contains a cycle");
    seen.add(cursor.id);
    lineage.unshift(cursor);
    cursor = cursor.parentBranchId ? byId.get(cursor.parentBranchId) : undefined;
  }

  return lineage;
}

export function visibleMessages(branches: ChatBranch[], activeBranchId: string): ChatMessage[] {
  const lineage = branchLineage(branches, activeBranchId);
  const activeBranch = lineage.at(-1);
  if (!activeBranch || lineage.length === 1) return activeBranch?.messages ?? [];

  const snapshot =
    activeBranch.contextMessageIds === undefined
      ? undefined
      : new Set(activeBranch.contextMessageIds);
  return lineage.flatMap((branch, index) => {
    if (index === lineage.length - 1) return branch.messages;
    if (snapshot) return branch.messages.filter((message) => snapshot.has(message.id));
    return branch.messages.filter((message) => message.createdAt <= activeBranch.createdAt);
  });
}

/** Groups direct child branches by the inherited turn where they diverged. */
export function childBranchesBySourceMessage(
  branches: readonly ChatBranch[],
  parentBranchId: string,
): ReadonlyMap<string, ChatBranch[]> {
  const grouped = new Map<string, ChatBranch[]>();

  for (const branch of branches) {
    if (branch.parentBranchId !== parentBranchId) continue;
    const sourceMessageId = branch.anchor?.sourceMessageId ?? branch.contextMessageIds?.at(-1);
    if (!sourceMessageId) continue;
    const children = grouped.get(sourceMessageId) ?? [];
    children.push(branch);
    grouped.set(sourceMessageId, children);
  }

  for (const children of grouped.values()) {
    children.sort((left, right) => left.createdAt - right.createdAt);
  }
  return grouped;
}
