/** Materializes bounded, provider-neutral context for a newly forked chat branch. */

import type {
  BranchId,
  ChatBranch,
  ChatMessage,
  MessageId,
  MessageRole,
  TextSelection,
} from "./types";

export interface ContextMaterializerOptions {
  maxMessages: number;
  maxTranscriptCharacters: number;
  maxMessageCharacters: number;
  selectionSurroundingCharacters: number;
}

/** Domain-local defaults are shared by web and desktop consumers of this package. */
export const DEFAULT_CONTEXT_MATERIALIZER_OPTIONS = {
  maxMessages: 12,
  maxTranscriptCharacters: 6_000,
  maxMessageCharacters: 1_600,
  selectionSurroundingCharacters: 320,
} as const satisfies ContextMaterializerOptions;

export type ContextMaterializationErrorCode =
  | "invalid_options"
  | "invalid_branch"
  | "missing_anchor"
  | "duplicate_message"
  | "message_mismatch"
  | "invalid_selection";

export class ContextMaterializationError extends Error {
  readonly code: ContextMaterializationErrorCode;
  readonly branchId?: BranchId;
  readonly messageId?: MessageId;

  constructor(
    code: ContextMaterializationErrorCode,
    message: string,
    details?: { branchId?: BranchId; messageId?: MessageId },
  ) {
    super(message);
    this.name = "ContextMaterializationError";
    this.code = code;
    this.branchId = details?.branchId;
    this.messageId = details?.messageId;
  }
}

export interface MaterializedTranscriptMessage {
  messageId: MessageId;
  role: MessageRole;
  content: string;
  truncated: boolean;
}

export interface MaterializedSelection {
  sourceMessageId: MessageId;
  sourceRole: MessageRole;
  selectedText: string;
  surroundingText: string;
}

export interface MaterializedBranchContext {
  transcript: readonly MaterializedTranscriptMessage[];
  includedMessageIds: readonly MessageId[];
  selection?: MaterializedSelection;
  branchPrompt?: string;
  renderedContext: string;
  truncated: boolean;
}

export interface MaterializeBranchContextInput {
  branch: ChatBranch;
  parentMessages: readonly ChatMessage[];
  options?: Partial<ContextMaterializerOptions>;
}

const ROLE_LABELS: Record<MessageRole, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
};

function resolveOptions(
  overrides: Partial<ContextMaterializerOptions> | undefined,
): ContextMaterializerOptions {
  const resolved = { ...DEFAULT_CONTEXT_MATERIALIZER_OPTIONS, ...overrides };
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ContextMaterializationError(
        "invalid_options",
        `Context materializer option '${key}' must be a positive integer`,
      );
    }
  }
  return {
    ...resolved,
    maxMessageCharacters: Math.min(resolved.maxMessageCharacters, resolved.maxTranscriptCharacters),
  };
}

function compareMessages(left: ChatMessage, right: ChatMessage): number {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  return String(left.id).localeCompare(String(right.id));
}

function messageToText(message: ChatMessage): string {
  const chunks: string[] = [];
  for (const part of message.parts) {
    switch (part.type) {
      case "text":
        if (part.text.length > 0) chunks.push(part.text);
        break;
      case "reasoning":
        // Reasoning is intentionally not replayed as conversational context.
        break;
      case "blob":
        chunks.push(`[Attachment: ${part.name ?? part.mediaType}]`);
        break;
      case "tool_call":
        chunks.push(`[Tool call: ${part.toolName}]`);
        break;
      case "tool_result":
        chunks.push(`[Tool result: ${part.toolName}${part.isError ? " (error)" : ""}]`);
        break;
      case "citation":
        chunks.push(`[Citation: ${part.title ?? part.uri}]`);
        break;
    }
  }
  return chunks.join("\n").trim();
}

function truncateMiddle(value: string, limit: number): { value: string; truncated: boolean } {
  if (value.length <= limit) return { value, truncated: false };
  if (limit <= 1) return { value: "…".slice(0, limit), truncated: true };
  const contentBudget = limit - 1;
  const headLength = Math.ceil(contentBudget / 2);
  const tailLength = Math.floor(contentBudget / 2);
  return {
    value: `${value.slice(0, headLength)}…${value.slice(value.length - tailLength)}`,
    truncated: true,
  };
}

function validateSelection(message: ChatMessage, selection: TextSelection): string {
  const part = message.parts[selection.partIndex];
  if (part?.type !== "text") {
    throw new ContextMaterializationError(
      "invalid_selection",
      `Selection for message '${message.id}' must reference a text part`,
      { messageId: message.id },
    );
  }
  if (
    !Number.isInteger(selection.startOffset) ||
    !Number.isInteger(selection.endOffset) ||
    selection.startOffset < 0 ||
    selection.endOffset <= selection.startOffset ||
    selection.endOffset > part.text.length
  ) {
    throw new ContextMaterializationError(
      "invalid_selection",
      `Selection for message '${message.id}' has invalid offsets`,
      { messageId: message.id },
    );
  }
  const selectedText = part.text.slice(selection.startOffset, selection.endOffset);
  if (selectedText !== selection.selectedText) {
    throw new ContextMaterializationError(
      "invalid_selection",
      `Selection text no longer matches message '${message.id}'`,
      { messageId: message.id },
    );
  }
  return part.text;
}

function selectionSurroundingText(
  sourceText: string,
  selection: TextSelection,
  surroundingCharacters: number,
): string {
  const start = Math.max(0, selection.startOffset - surroundingCharacters);
  const end = Math.min(sourceText.length, selection.endOffset + surroundingCharacters);
  const prefix = sourceText.slice(start, selection.startOffset);
  const suffix = sourceText.slice(selection.endOffset, end);
  return `${start > 0 ? "…" : ""}${prefix}[[${selection.selectedText}]]${suffix}${
    end < sourceText.length ? "…" : ""
  }`;
}

function renderContext(
  transcript: readonly MaterializedTranscriptMessage[],
  selection: MaterializedSelection | undefined,
  branchPrompt: string | undefined,
): string {
  const sections: string[] = [];
  if (transcript.length > 0) {
    const renderedTranscript = transcript
      .map((message) => `[${ROLE_LABELS[message.role]}]\n${message.content}`)
      .join("\n\n");
    sections.push(`Parent conversation excerpt:\n${renderedTranscript}`);
  }
  if (selection) {
    sections.push(
      `Highlighted selection from ${ROLE_LABELS[selection.sourceRole]}:\n${selection.surroundingText}`,
    );
  }
  if (branchPrompt) sections.push(`Branch request:\n${branchPrompt}`);
  return sections.join("\n\n");
}

/** Materializes a recent parent transcript ending at the branch origin's anchor. */
export function materializeBranchContext(
  input: MaterializeBranchContextInput,
): MaterializedBranchContext {
  const { branch } = input;
  if (branch.parentBranchId === undefined || branch.origin.type === "root") {
    throw new ContextMaterializationError(
      "invalid_branch",
      "Root branches do not have parent context to materialize",
      { branchId: branch.id },
    );
  }
  const options = resolveOptions(input.options);
  const sortedMessages = [...input.parentMessages].sort(compareMessages);
  const messageIds = new Set<MessageId>();
  for (const message of sortedMessages) {
    if (messageIds.has(message.id)) {
      throw new ContextMaterializationError(
        "duplicate_message",
        `Message ID '${message.id}' appears more than once`,
        { branchId: branch.id, messageId: message.id },
      );
    }
    messageIds.add(message.id);
    if (message.workspaceId !== branch.workspaceId || message.chatId !== branch.chatId) {
      throw new ContextMaterializationError(
        "message_mismatch",
        `Message '${message.id}' belongs to a different chat or workspace`,
        { branchId: branch.id, messageId: message.id },
      );
    }
  }

  const anchorId =
    branch.origin.type === "prompt" ? branch.origin.anchorMessageId : branch.origin.sourceMessageId;
  const anchorIndex = sortedMessages.findIndex((message) => message.id === anchorId);
  if (anchorIndex < 0) {
    throw new ContextMaterializationError(
      "missing_anchor",
      `Branch '${branch.id}' references missing message '${anchorId}'`,
      { branchId: branch.id, messageId: anchorId },
    );
  }

  const anchorMessage = sortedMessages[anchorIndex];
  if (!anchorMessage) {
    throw new ContextMaterializationError(
      "missing_anchor",
      `Branch '${branch.id}' references missing message '${anchorId}'`,
      { branchId: branch.id, messageId: anchorId },
    );
  }

  let selection: MaterializedSelection | undefined;
  if (branch.origin.type === "selection") {
    const sourceText = validateSelection(anchorMessage, branch.origin.selection);
    selection = {
      sourceMessageId: anchorMessage.id,
      sourceRole: anchorMessage.role,
      selectedText: branch.origin.selection.selectedText,
      surroundingText: selectionSurroundingText(
        sourceText,
        branch.origin.selection,
        options.selectionSurroundingCharacters,
      ),
    };
  }

  const eligible = sortedMessages.slice(0, anchorIndex + 1);
  const messageWindow = eligible.slice(Math.max(0, eligible.length - options.maxMessages));
  const transcriptReversed: MaterializedTranscriptMessage[] = [];
  let remainingCharacters = options.maxTranscriptCharacters;
  let contentWasTruncated = messageWindow.length < eligible.length;

  for (let index = messageWindow.length - 1; index >= 0; index -= 1) {
    const message = messageWindow[index];
    if (!message) continue;
    const rawContent = messageToText(message);
    if (rawContent.length === 0) continue;
    if (remainingCharacters <= 0) {
      contentWasTruncated = true;
      break;
    }
    const limit = Math.min(options.maxMessageCharacters, remainingCharacters);
    const result = truncateMiddle(rawContent, limit);
    transcriptReversed.push({
      messageId: message.id,
      role: message.role,
      content: result.value,
      truncated: result.truncated,
    });
    remainingCharacters -= result.value.length;
    contentWasTruncated ||= result.truncated;
  }

  const transcript = transcriptReversed.reverse();
  if (
    transcript.length < messageWindow.filter((message) => messageToText(message).length > 0).length
  ) {
    contentWasTruncated = true;
  }

  const branchPrompt = branch.origin.prompt?.trim() || undefined;
  if (branch.origin.type === "prompt" && branchPrompt === undefined) {
    throw new ContextMaterializationError(
      "invalid_branch",
      "Prompt-only branches require a non-empty prompt",
      { branchId: branch.id },
    );
  }

  return {
    transcript,
    includedMessageIds: transcript.map((message) => message.messageId),
    selection,
    branchPrompt,
    renderedContext: renderContext(transcript, selection, branchPrompt),
    truncated: contentWasTruncated,
  };
}
