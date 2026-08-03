/** Builds a bounded provider-neutral context window for a runtime request. */

import type { BranchAnchor, ChatMessage } from "./conversation";

export type RuntimeContextLimits = {
  maxMessages: number;
  maxCharacters: number;
  maxMessageCharacters: number;
  maxSelectionCharacters: number;
};

export const DEFAULT_RUNTIME_CONTEXT_LIMITS = {
  maxMessages: 24,
  maxCharacters: 120_000,
  maxMessageCharacters: 32_000,
  maxSelectionCharacters: 4_000,
} as const satisfies RuntimeContextLimits;

function truncateMiddle(value: string, limit: number): string {
  if (value.length <= limit) return value;
  if (limit <= 1) return "…".slice(0, limit);
  const available = limit - 1;
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function selectionMessage(
  anchor: BranchAnchor | undefined,
  limit: number,
): ChatMessage | undefined {
  const selection = anchor?.selectedText?.trim();
  if (!selection) return undefined;
  const content = [
    "This branch follows a passage highlighted by the user. Treat it as the branch's explicit focus:",
    `“${truncateMiddle(selection, limit)}”`,
  ].join("\n\n");
  return {
    id: "runtime:branch-selection",
    branchId: "runtime",
    role: "system",
    content,
    createdAt: Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Keeps the newest useful messages within deterministic character and count
 * budgets. A branch selection is injected after the transcript so it cannot
 * disappear when an old source message falls outside the rolling window.
 */
export function buildRuntimeContext(
  messages: readonly ChatMessage[],
  anchor?: BranchAnchor,
  overrides: Partial<RuntimeContextLimits> = {},
): ChatMessage[] {
  const limits = { ...DEFAULT_RUNTIME_CONTEXT_LIMITS, ...overrides };
  if (
    !Number.isInteger(limits.maxMessages) ||
    !Number.isInteger(limits.maxCharacters) ||
    !Number.isInteger(limits.maxMessageCharacters) ||
    !Number.isInteger(limits.maxSelectionCharacters) ||
    Object.values(limits).some((value) => value <= 0)
  ) {
    throw new Error("Runtime context limits must be positive integers.");
  }

  const focus = selectionMessage(anchor, limits.maxSelectionCharacters);
  let remaining = Math.max(0, limits.maxCharacters - (focus?.content.length ?? 0));
  const selected: ChatMessage[] = [];

  for (
    let index = messages.length - 1;
    index >= 0 && selected.length < limits.maxMessages;
    index -= 1
  ) {
    const message = messages[index];
    if (!message || message.isError) continue;
    const content = message.content.trim();
    if (!content || remaining <= 0) continue;
    const bounded = truncateMiddle(content, Math.min(limits.maxMessageCharacters, remaining));
    selected.push({ ...message, content: bounded, isStreaming: false });
    remaining -= bounded.length;
  }

  selected.reverse();
  if (focus) selected.push(focus);
  return selected;
}
