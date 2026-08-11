/** Pure helpers for optimistic branch and message state. */

import type { BranchAnchor, ChatBranch, ChatMessage } from "./conversation";

export function branchTitle(anchor: BranchAnchor): string {
  return (
    anchor.displayText?.trim() ||
    anchor.selectedText?.trim() ||
    anchor.prompt.trim() ||
    "New branch"
  ).slice(0, 200);
}

export function updateBranchTitle(
  branches: ChatBranch[],
  branchId: string,
  title: string,
): ChatBranch[] {
  return branches.map((branch) => (branch.id === branchId ? { ...branch, title } : branch));
}

export function contextSnapshot(
  messages: readonly ChatMessage[],
  sourceMessageId?: string,
): string[] {
  const recent = messages.slice(-16).map((message) => message.id);
  if (!sourceMessageId || recent.includes(sourceMessageId)) return recent;
  return [...recent.slice(-15), sourceMessageId];
}

export function appendToBranch(
  branches: ChatBranch[],
  branchId: string,
  messages: ChatMessage[],
): ChatBranch[] {
  return branches.map((branch) =>
    branch.id === branchId ? { ...branch, messages: [...branch.messages, ...messages] } : branch,
  );
}

export function updateBranchMessage(
  branches: ChatBranch[],
  branchId: string,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatBranch[] {
  return branches.map((branch) =>
    branch.id === branchId
      ? {
          ...branch,
          messages: branch.messages.map((message) =>
            message.id === messageId ? update(message) : message,
          ),
        }
      : branch,
  );
}
