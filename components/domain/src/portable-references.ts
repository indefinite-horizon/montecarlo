/** Validates graph and referential invariants after portable workspace shape checks pass. */

import { BranchTreeError, buildBranchTree, getBranchPath } from "./branch-tree";
import type { PortableValidationIssue, PortableWorkspaceManifest } from "./portable";
import type { ChatMessage, MessagePart, TextSelection } from "./types";

function addIssue(
  issues: PortableValidationIssue[],
  path: string,
  code: PortableValidationIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

function indexById<T extends { id: string }>(
  entries: readonly T[],
  path: string,
  issues: PortableValidationIssue[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (result.has(entry.id)) {
      addIssue(
        issues,
        `${path}[${index}].id`,
        "duplicate_id",
        `ID '${entry.id}' appears more than once`,
      );
    } else {
      result.set(entry.id, entry);
    }
  }
  return result;
}

function validateSelectionAgainstMessage(
  selection: TextSelection,
  message: ChatMessage,
  path: string,
  issues: PortableValidationIssue[],
): void {
  const part = message.parts[selection.partIndex];
  if (
    part?.type !== "text" ||
    selection.endOffset <= selection.startOffset ||
    selection.endOffset > part.text.length ||
    part.text.slice(selection.startOffset, selection.endOffset) !== selection.selectedText
  ) {
    addIssue(
      issues,
      path,
      "invalid_selection",
      `Selection does not match source message '${message.id}'`,
    );
  }
}

function validateMessageBlobReferences(
  parts: readonly MessagePart[],
  blobIds: ReadonlySet<string>,
  path: string,
  issues: PortableValidationIssue[],
): void {
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part?.type === "blob" && !blobIds.has(part.blobId)) {
      addIssue(
        issues,
        `${path}.parts[${index}].blobId`,
        "missing_reference",
        `Blob '${part.blobId}' does not exist in the manifest`,
      );
    }
  }
}

/** Adds all cross-record, branch-tree, sequence, blob, and selection issues. */
export function validatePortableWorkspaceManifestReferences(
  manifest: PortableWorkspaceManifest,
  issues: PortableValidationIssue[],
): void {
  const workspaceId = manifest.workspace.id;
  const projects = indexById(manifest.projects, "$.manifest.projects", issues);
  const chats = indexById(manifest.chats, "$.manifest.chats", issues);
  const branches = indexById(manifest.branches, "$.manifest.branches", issues);
  const messages = indexById(manifest.messages, "$.manifest.messages", issues);
  const runs = indexById(manifest.runs, "$.manifest.runs", issues);
  const blobs = indexById(manifest.blobs, "$.manifest.blobs", issues);
  const blobIds = new Set(blobs.keys());

  for (let index = 0; index < manifest.projects.length; index += 1) {
    const project = manifest.projects[index];
    if (project && project.workspaceId !== workspaceId) {
      addIssue(
        issues,
        `$.manifest.projects[${index}].workspaceId`,
        "reference_mismatch",
        "Project belongs to a different workspace",
      );
    }
  }

  for (let index = 0; index < manifest.chats.length; index += 1) {
    const chat = manifest.chats[index];
    if (!chat) continue;
    if (chat.workspaceId !== workspaceId) {
      addIssue(
        issues,
        `$.manifest.chats[${index}].workspaceId`,
        "reference_mismatch",
        "Chat belongs to a different workspace",
      );
    }
    if (chat.projectId !== undefined && !projects.has(chat.projectId)) {
      addIssue(
        issues,
        `$.manifest.chats[${index}].projectId`,
        "missing_reference",
        `Project '${chat.projectId}' does not exist`,
      );
    }
    const root = branches.get(chat.rootBranchId);
    if (!root || root.chatId !== chat.id) {
      addIssue(
        issues,
        `$.manifest.chats[${index}].rootBranchId`,
        "missing_reference",
        `Root branch '${chat.rootBranchId}' does not belong to this chat`,
      );
    }
  }

  const treesByChat = new Map<string, ReturnType<typeof buildBranchTree>>();
  for (const chat of manifest.chats) {
    const chatBranches = manifest.branches.filter((branch) => branch.chatId === chat.id);
    try {
      treesByChat.set(chat.id, buildBranchTree(chatBranches, chat.rootBranchId));
    } catch (error) {
      const detail =
        error instanceof BranchTreeError ? `${error.code}: ${error.message}` : String(error);
      addIssue(issues, "$.manifest.branches", "branch_tree", detail);
    }
  }

  for (let index = 0; index < manifest.branches.length; index += 1) {
    const branch = manifest.branches[index];
    if (!branch) continue;
    const chat = chats.get(branch.chatId);
    if (!chat) {
      addIssue(
        issues,
        `$.manifest.branches[${index}].chatId`,
        "missing_reference",
        `Chat '${branch.chatId}' does not exist`,
      );
      continue;
    }
    if (branch.workspaceId !== workspaceId) {
      addIssue(
        issues,
        `$.manifest.branches[${index}].workspaceId`,
        "reference_mismatch",
        "Branch belongs to a different workspace",
      );
    }
    if (branch.origin.type === "root") continue;
    const sourceId =
      branch.origin.type === "prompt"
        ? branch.origin.anchorMessageId
        : branch.origin.sourceMessageId;
    const source = messages.get(sourceId);
    if (!source) {
      addIssue(
        issues,
        `$.manifest.branches[${index}].origin`,
        "missing_reference",
        `Source message '${sourceId}' does not exist`,
      );
      continue;
    }
    if (source.workspaceId !== workspaceId || source.chatId !== branch.chatId) {
      addIssue(
        issues,
        `$.manifest.branches[${index}].origin`,
        "reference_mismatch",
        `Source message '${sourceId}' belongs to a different chat or workspace`,
      );
    }
    const tree = treesByChat.get(branch.chatId);
    if (tree && branch.parentBranchId !== undefined) {
      const ancestorIds = new Set(
        getBranchPath(tree, branch.parentBranchId).map((ancestor) => ancestor.id),
      );
      if (!ancestorIds.has(source.branchId)) {
        addIssue(
          issues,
          `$.manifest.branches[${index}].origin`,
          "reference_mismatch",
          `Source message '${sourceId}' is not in the parent transcript`,
        );
      }
    }
    if (branch.origin.type === "selection") {
      validateSelectionAgainstMessage(
        branch.origin.selection,
        source,
        `$.manifest.branches[${index}].origin.selection`,
        issues,
      );
    }
  }

  const messageSequences = new Set<string>();
  for (let index = 0; index < manifest.messages.length; index += 1) {
    const message = manifest.messages[index];
    if (!message) continue;
    const branch = branches.get(message.branchId);
    if (!branch) {
      addIssue(
        issues,
        `$.manifest.messages[${index}].branchId`,
        "missing_reference",
        `Branch '${message.branchId}' does not exist`,
      );
    } else if (branch.chatId !== message.chatId) {
      addIssue(
        issues,
        `$.manifest.messages[${index}].chatId`,
        "reference_mismatch",
        "Message chat does not match its branch",
      );
    }
    if (message.workspaceId !== workspaceId || !chats.has(message.chatId)) {
      addIssue(
        issues,
        `$.manifest.messages[${index}]`,
        "reference_mismatch",
        "Message belongs to an unknown chat or workspace",
      );
    }
    const sequenceKey = `${message.branchId}\u0000${message.sequence}`;
    if (messageSequences.has(sequenceKey)) {
      addIssue(
        issues,
        `$.manifest.messages[${index}].sequence`,
        "duplicate_id",
        `Sequence ${message.sequence} is duplicated within branch '${message.branchId}'`,
      );
    }
    messageSequences.add(sequenceKey);
    if (message.runId !== undefined) {
      const run = runs.get(message.runId);
      if (!run) {
        addIssue(
          issues,
          `$.manifest.messages[${index}].runId`,
          "missing_reference",
          `Run '${message.runId}' does not exist`,
        );
      } else if (run.branchId !== message.branchId || run.chatId !== message.chatId) {
        addIssue(
          issues,
          `$.manifest.messages[${index}].runId`,
          "reference_mismatch",
          `Run '${message.runId}' belongs to a different chat branch`,
        );
      }
    }
    validateMessageBlobReferences(message.parts, blobIds, `$.manifest.messages[${index}]`, issues);
  }

  for (let index = 0; index < manifest.runs.length; index += 1) {
    const run = manifest.runs[index];
    if (!run) continue;
    const branch = branches.get(run.branchId);
    const request = messages.get(run.requestMessageId);
    const response = run.responseMessageId ? messages.get(run.responseMessageId) : undefined;
    if (!branch || branch.chatId !== run.chatId || run.workspaceId !== workspaceId) {
      addIssue(
        issues,
        `$.manifest.runs[${index}]`,
        "reference_mismatch",
        "Run belongs to an unknown branch, chat, or workspace",
      );
    }
    if (!request || request.branchId !== run.branchId || request.chatId !== run.chatId) {
      addIssue(
        issues,
        `$.manifest.runs[${index}].requestMessageId`,
        "missing_reference",
        "Run request message must belong to the run branch",
      );
    }
    if (
      run.responseMessageId !== undefined &&
      (!response || response.branchId !== run.branchId || response.chatId !== run.chatId)
    ) {
      addIssue(
        issues,
        `$.manifest.runs[${index}].responseMessageId`,
        "missing_reference",
        "Run response message must belong to the run branch",
      );
    }
  }
}
