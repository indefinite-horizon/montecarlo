/** Unit tests for bounded parent transcript and highlighted-selection materialization. */

import { describe, expect, it } from "vitest";
import {
  type BranchId,
  type ChatBranch,
  type ChatMessage,
  type ContextMaterializationError,
  domainId,
  type MessagePart,
  type MessageRole,
  materializeBranchContext,
} from "../../components/domain/src";

const workspaceId = domainId<"workspace">("workspace-context");
const chatId = domainId<"chat">("chat-context");
const parentBranchId = domainId<"branch">("branch-parent");

function makeMessage(
  idValue: string,
  sequence: number,
  text: string,
  createdAt: number,
  role: MessageRole = "user",
  branchId: BranchId = parentBranchId,
  parts?: MessagePart[],
): ChatMessage {
  return {
    id: domainId<"message">(idValue),
    workspaceId,
    chatId,
    branchId,
    sequence,
    role,
    parts: parts ?? [{ type: "text", text }],
    status: "complete",
    createdAt,
    updatedAt: createdAt,
  };
}

describe("branch context materializer", () => {
  it("keeps an exact selection separate while rendering bounded surrounding context", () => {
    const first = makeMessage("message-first", 0, "Start here.", 1);
    const sourceText = "Alpha beta gamma delta epsilon";
    const source = makeMessage("message-source", 1, sourceText, 2, "assistant", parentBranchId, [
      { type: "reasoning", text: "private chain of thought", state: "complete" },
      { type: "text", text: sourceText },
    ]);
    const later = makeMessage("message-later", 2, "This must not leak past the anchor.", 3);
    const selectionStart = sourceText.indexOf("beta gamma");
    const branch: ChatBranch = {
      id: domainId<"branch">("branch-selection"),
      workspaceId,
      chatId,
      parentBranchId,
      origin: {
        type: "selection",
        sourceMessageId: source.id,
        selection: {
          partIndex: 1,
          startOffset: selectionStart,
          endOffset: selectionStart + "beta gamma".length,
          selectedText: "beta gamma",
        },
        prompt: "  Why does this matter?  ",
      },
      createdAt: 4,
    };

    const result = materializeBranchContext({
      branch,
      parentMessages: [later, source, first],
      options: { selectionSurroundingCharacters: 3 },
    });

    expect(result.includedMessageIds).toEqual([first.id, source.id]);
    expect(result.selection).toMatchObject({
      sourceMessageId: source.id,
      selectedText: "beta gamma",
      surroundingText: "…ha [[beta gamma]] de…",
    });
    expect(result.branchPrompt).toBe("Why does this matter?");
    expect(result.renderedContext).toContain("[[beta gamma]]");
    expect(result.renderedContext).not.toContain("private chain of thought");
    expect(result.renderedContext).not.toContain("must not leak");
  });

  it("takes the most recent messages through the anchor and respects both budgets", () => {
    const first = makeMessage("message-0", 0, "oldest-message", 1);
    const second = makeMessage("message-1", 1, "middle-message-is-long", 2, "assistant");
    const anchor = makeMessage("message-2", 2, "anchor-message-is-long", 3);
    const branch: ChatBranch = {
      id: domainId<"branch">("branch-prompt"),
      workspaceId,
      chatId,
      parentBranchId,
      origin: {
        type: "prompt",
        anchorMessageId: anchor.id,
        prompt: "Take another path",
      },
      createdAt: 4,
    };

    const result = materializeBranchContext({
      branch,
      parentMessages: [anchor, first, second],
      options: {
        maxMessages: 2,
        maxTranscriptCharacters: 20,
        maxMessageCharacters: 12,
      },
    });

    expect(result.includedMessageIds).toEqual([second.id, anchor.id]);
    expect(result.transcript.reduce((total, message) => total + message.content.length, 0)).toBe(
      20,
    );
    expect(result.transcript.every((message) => message.truncated)).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("rejects stale selections, missing anchors, and empty prompt-only branches", () => {
    const source = makeMessage("message-source", 0, "Stable source text", 1, "assistant");
    const selectionBranch: ChatBranch = {
      id: domainId<"branch">("branch-selection"),
      workspaceId,
      chatId,
      parentBranchId,
      origin: {
        type: "selection",
        sourceMessageId: source.id,
        selection: {
          partIndex: 0,
          startOffset: 0,
          endOffset: 6,
          selectedText: "Changed",
        },
      },
      createdAt: 2,
    };
    expect(() =>
      materializeBranchContext({ branch: selectionBranch, parentMessages: [source] }),
    ).toThrowError(expect.objectContaining({ code: "invalid_selection" }));

    const promptBranch: ChatBranch = {
      ...selectionBranch,
      id: domainId<"branch">("branch-prompt"),
      origin: {
        type: "prompt",
        anchorMessageId: source.id,
        prompt: "   ",
      },
    };
    expect(() =>
      materializeBranchContext({ branch: promptBranch, parentMessages: [source] }),
    ).toThrowError(expect.objectContaining({ code: "invalid_branch" }));

    const missingAnchorBranch: ChatBranch = {
      ...promptBranch,
      origin: {
        type: "prompt",
        anchorMessageId: domainId<"message">("message-missing"),
        prompt: "Continue",
      },
    };
    expect(() =>
      materializeBranchContext({ branch: missingAnchorBranch, parentMessages: [source] }),
    ).toThrowError(
      expect.objectContaining<Partial<ContextMaterializationError>>({
        code: "missing_anchor",
      }),
    );
  });
});
