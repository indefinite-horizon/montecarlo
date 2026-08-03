/** Shared, storage-neutral domain fixtures for Monte Carlo unit tests. */

import {
  domainId,
  PORTABLE_WORKSPACE_ENVELOPE_VERSION,
  PORTABLE_WORKSPACE_FORMAT,
  PORTABLE_WORKSPACE_SCHEMA_VERSION,
  type PortableWorkspaceEnvelope,
} from "../../components/domain/src";

export const fixtureIds = {
  workspace: domainId<"workspace">("workspace-1"),
  project: domainId<"project">("project-1"),
  chat: domainId<"chat">("chat-1"),
  rootBranch: domainId<"branch">("branch-root"),
  childBranch: domainId<"branch">("branch-child"),
  rootUserMessage: domainId<"message">("message-root-user"),
  rootAssistantMessage: domainId<"message">("message-root-assistant"),
  childUserMessage: domainId<"message">("message-child-user"),
  childAssistantMessage: domainId<"message">("message-child-assistant"),
  childRun: domainId<"run">("run-child"),
} as const;

const sourceText = "Roots support trunks and branches.";
const selectionStart = sourceText.indexOf("branches");

/** Returns a fresh, fully connected portable workspace envelope. */
export function makePortableWorkspaceEnvelope(): PortableWorkspaceEnvelope {
  return {
    format: PORTABLE_WORKSPACE_FORMAT,
    envelopeVersion: PORTABLE_WORKSPACE_ENVELOPE_VERSION,
    exportedAt: 10,
    manifest: {
      schemaVersion: PORTABLE_WORKSPACE_SCHEMA_VERSION,
      workspace: {
        id: fixtureIds.workspace,
        name: "Example workspace",
        createdAt: 1,
        updatedAt: 9,
      },
      projects: [
        {
          id: fixtureIds.project,
          workspaceId: fixtureIds.workspace,
          name: "Biology",
          createdAt: 1,
          updatedAt: 9,
        },
      ],
      chats: [
        {
          id: fixtureIds.chat,
          workspaceId: fixtureIds.workspace,
          projectId: fixtureIds.project,
          rootBranchId: fixtureIds.rootBranch,
          title: "How trees grow",
          createdAt: 1,
          updatedAt: 9,
        },
      ],
      branches: [
        {
          id: fixtureIds.rootBranch,
          workspaceId: fixtureIds.workspace,
          chatId: fixtureIds.chat,
          origin: { type: "root" },
          createdAt: 1,
        },
        {
          id: fixtureIds.childBranch,
          workspaceId: fixtureIds.workspace,
          chatId: fixtureIds.chat,
          parentBranchId: fixtureIds.rootBranch,
          origin: {
            type: "selection",
            sourceMessageId: fixtureIds.rootAssistantMessage,
            selection: {
              partIndex: 0,
              startOffset: selectionStart,
              endOffset: selectionStart + "branches".length,
              selectedText: "branches",
            },
            prompt: "Explain that part in more detail.",
          },
          createdAt: 4,
        },
      ],
      messages: [
        {
          id: fixtureIds.rootUserMessage,
          workspaceId: fixtureIds.workspace,
          chatId: fixtureIds.chat,
          branchId: fixtureIds.rootBranch,
          sequence: 0,
          role: "user",
          parts: [{ type: "text", text: "Tell me about trees." }],
          status: "complete",
          createdAt: 2,
          updatedAt: 2,
        },
        {
          id: fixtureIds.rootAssistantMessage,
          workspaceId: fixtureIds.workspace,
          chatId: fixtureIds.chat,
          branchId: fixtureIds.rootBranch,
          sequence: 1,
          role: "assistant",
          parts: [{ type: "text", text: sourceText }],
          status: "complete",
          createdAt: 3,
          updatedAt: 3,
        },
        {
          id: fixtureIds.childUserMessage,
          workspaceId: fixtureIds.workspace,
          chatId: fixtureIds.chat,
          branchId: fixtureIds.childBranch,
          sequence: 0,
          role: "user",
          parts: [{ type: "text", text: "Explain that part in more detail." }],
          status: "complete",
          createdAt: 5,
          updatedAt: 5,
        },
        {
          id: fixtureIds.childAssistantMessage,
          workspaceId: fixtureIds.workspace,
          chatId: fixtureIds.chat,
          branchId: fixtureIds.childBranch,
          sequence: 1,
          role: "assistant",
          parts: [{ type: "text", text: "Branches carry leaves toward the light." }],
          status: "complete",
          runId: fixtureIds.childRun,
          createdAt: 6,
          updatedAt: 7,
        },
      ],
      runs: [
        {
          id: fixtureIds.childRun,
          workspaceId: fixtureIds.workspace,
          chatId: fixtureIds.chat,
          branchId: fixtureIds.childBranch,
          requestMessageId: fixtureIds.childUserMessage,
          responseMessageId: fixtureIds.childAssistantMessage,
          target: { provider: "ollama", modelId: "qwen3:8b" },
          status: "complete",
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          createdAt: 5,
          startedAt: 5,
          finishedAt: 7,
        },
      ],
      blobs: [],
    },
  };
}
