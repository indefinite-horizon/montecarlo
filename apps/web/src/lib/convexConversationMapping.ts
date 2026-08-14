/** Maps Convex conversation records into browser-facing view models. */

import type { ChatMessage, ProjectSummary, ProviderId } from "@/lib/conversation";
import type { MessagePage } from "@/lib/convexDomainApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { messageHydrationKey } from "../hooks/useMessageContentHydration";

const PROJECT_COLORS = ["terracotta", "blue", "gold", "green"] as const;

export function projectsFromItems(
  projects: Array<{ id: unknown; publicId: string; name: string }>,
): ProjectSummary[] {
  return projects.map((project, index) => ({
    id: String(project.id),
    publicId: project.publicId,
    name: project.name,
    color: PROJECT_COLORS[index % PROJECT_COLORS.length] ?? "terracotta",
  }));
}

export function titleForBranch(
  branch: {
    title?: string;
    anchorPrompt?: string;
    anchorSelection?: { quote: string; displayText?: string };
    contextPreview?: string;
    depth: number;
  },
  chatTitle: string,
): string {
  if (branch.depth === 0) return chatTitle;
  if (branch.title) return branch.title;
  const value =
    branch.anchorSelection?.displayText ??
    branch.anchorSelection?.quote ??
    branch.anchorPrompt ??
    branch.contextPreview;
  if (!value) return chatTitle;
  return value.length > 38 ? `${value.slice(0, 37).trim()}…` : value;
}

export function lineageIds(
  branches: Array<{ id: Id<"chat_branches">; parentBranchId?: Id<"chat_branches"> }>,
  requestedBranchId: string,
  rootBranchId: Id<"chat_branches">,
): Id<"chat_branches">[] {
  const byId = new Map(branches.map((branch) => [String(branch.id), branch]));
  const requested = byId.get(requestedBranchId) ?? byId.get(String(rootBranchId));
  const lineage: Id<"chat_branches">[] = [];
  const seen = new Set<string>();
  let cursor = requested;

  while (cursor) {
    const id = String(cursor.id);
    if (seen.has(id)) break;
    seen.add(id);
    lineage.unshift(cursor.id);
    cursor = cursor.parentBranchId ? byId.get(String(cursor.parentBranchId)) : undefined;
  }
  return lineage;
}

export function messageFromEnvelope(
  message: MessagePage["items"][number],
  hydratedContent: Record<string, string>,
  contentReady: boolean,
): ChatMessage {
  const hydrated = hydratedContent[messageHydrationKey(message)];
  const provider = ["codex", "anthropic", "ollama", "openrouter"].includes(message.provider ?? "")
    ? (message.provider as ProviderId)
    : undefined;
  return {
    id: String(message.id),
    publicId: message.publicId,
    persisted: true,
    branchId: String(message.branchId),
    role: message.role === "tool" ? "system" : message.role,
    content: hydrated ?? message.contentPreview,
    contentReady,
    createdAt: message.createdAt,
    provider,
    model: message.model,
    runStatus: message.runStatus,
  };
}
