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
  branchId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  provider?: ProviderId;
  model?: string;
  isStreaming?: boolean;
  isError?: boolean;
};

export type BranchAnchor = {
  sourceMessageId?: string;
  selectedText?: string;
  selectionStart?: number;
  selectionEnd?: number;
  prompt: string;
};

export type ChatBranch = {
  id: string;
  /** Stable portable identity used at browser and persistence boundaries. */
  publicId?: string;
  parentBranchId?: string;
  /** Immutable ancestor message snapshot captured when this branch is created. */
  contextMessageIds?: string[];
  title: string;
  depth: number;
  createdAt: number;
  anchor?: BranchAnchor;
  messages: ChatMessage[];
};

export type ChatSummary = {
  id: string;
  /** Stable portable identity used at browser and persistence boundaries. */
  publicId?: string;
  /** Stable portable identity of the chat's root branch. */
  rootBranchPublicId?: string;
  projectId?: string;
  title: string;
  updatedAt: number;
  branchCount: number;
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
  text: string;
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
