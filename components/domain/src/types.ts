/** Defines provider-neutral Monte Carlo entities and normalized runtime events. */

declare const domainIdBrand: unique symbol;

export type DomainId<Tag extends string> = string & {
  readonly [domainIdBrand]: Tag;
};

export type WorkspaceId = DomainId<"workspace">;
export type ProjectId = DomainId<"project">;
export type ChatId = DomainId<"chat">;
export type BranchId = DomainId<"branch">;
export type MessageId = DomainId<"message">;
export type RunId = DomainId<"run">;
export type RuntimeConnectionId = DomainId<"runtime_connection">;
export type RuntimeEventId = DomainId<"runtime_event">;
export type BlobId = DomainId<"blob">;

export type UnixTimeMs = number;

/** Creates a non-empty, JSON-compatible ID while retaining a nominal TypeScript tag. */
export function domainId<Tag extends string>(value: string): DomainId<Tag> {
  if (value.trim().length === 0) {
    throw new Error("Domain IDs must not be empty");
  }
  return value as DomainId<Tag>;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Workspace {
  id: WorkspaceId;
  name: string;
  createdAt: UnixTimeMs;
  updatedAt: UnixTimeMs;
}

export interface Project {
  id: ProjectId;
  workspaceId: WorkspaceId;
  name: string;
  description?: string;
  createdAt: UnixTimeMs;
  updatedAt: UnixTimeMs;
  archivedAt?: UnixTimeMs;
}

export interface Chat {
  id: ChatId;
  workspaceId: WorkspaceId;
  projectId?: ProjectId;
  rootBranchId: BranchId;
  title: string;
  createdAt: UnixTimeMs;
  updatedAt: UnixTimeMs;
  archivedAt?: UnixTimeMs;
}

export interface TextSelection {
  partIndex: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

export type BranchOrigin =
  | {
      type: "root";
    }
  | {
      type: "prompt";
      anchorMessageId: MessageId;
      prompt: string;
    }
  | {
      type: "selection";
      sourceMessageId: MessageId;
      selection: TextSelection;
      prompt?: string;
    };

export interface ChatBranch {
  id: BranchId;
  workspaceId: WorkspaceId;
  chatId: ChatId;
  parentBranchId?: BranchId;
  origin: BranchOrigin;
  title?: string;
  createdAt: UnixTimeMs;
}

export interface TextMessagePart {
  type: "text";
  text: string;
}

export interface ReasoningMessagePart {
  type: "reasoning";
  text: string;
  state?: "streaming" | "complete";
}

export interface BlobMessagePart {
  type: "blob";
  blobId: BlobId;
  mediaType: string;
  name?: string;
}

export interface ToolCallMessagePart {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: JsonValue;
}

export interface ToolResultMessagePart {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  output: JsonValue;
  isError?: boolean;
}

export interface CitationMessagePart {
  type: "citation";
  uri: string;
  title?: string;
}

export type MessagePart =
  | TextMessagePart
  | ReasoningMessagePart
  | BlobMessagePart
  | ToolCallMessagePart
  | ToolResultMessagePart
  | CitationMessagePart;

export type MessageRole = "system" | "user" | "assistant" | "tool";
export type MessageStatus = "streaming" | "complete" | "failed" | "cancelled";

export interface ChatMessage {
  id: MessageId;
  workspaceId: WorkspaceId;
  chatId: ChatId;
  branchId: BranchId;
  sequence: number;
  role: MessageRole;
  parts: MessagePart[];
  status: MessageStatus;
  runId?: RunId;
  createdAt: UnixTimeMs;
  updatedAt: UnixTimeMs;
}

export type RuntimeProvider = "codex" | "anthropic" | "openrouter" | "ollama";

export interface RuntimeTarget {
  provider: RuntimeProvider;
  modelId: string;
  connectionId?: RuntimeConnectionId;
}

export interface GenerationSettings {
  maxOutputTokens?: number;
  temperature?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export type RunStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

export interface RunError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ChatRun {
  id: RunId;
  workspaceId: WorkspaceId;
  chatId: ChatId;
  branchId: BranchId;
  requestMessageId: MessageId;
  responseMessageId?: MessageId;
  target: RuntimeTarget;
  settings?: GenerationSettings;
  status: RunStatus;
  usage?: TokenUsage;
  error?: RunError;
  createdAt: UnixTimeMs;
  startedAt?: UnixTimeMs;
  finishedAt?: UnixTimeMs;
}

interface RuntimeStreamEventBase {
  id: RuntimeEventId;
  runId: RunId;
  sequence: number;
  occurredAt: UnixTimeMs;
}

export type RuntimeStreamEvent =
  | (RuntimeStreamEventBase & {
      type: "run.started";
      target: RuntimeTarget;
    })
  | (RuntimeStreamEventBase & {
      type: "message.started";
      messageId: MessageId;
      role: "assistant" | "tool";
    })
  | (RuntimeStreamEventBase & {
      type: "text.delta";
      messageId: MessageId;
      partIndex: number;
      delta: string;
    })
  | (RuntimeStreamEventBase & {
      type: "reasoning.delta";
      messageId: MessageId;
      partIndex: number;
      delta: string;
    })
  | (RuntimeStreamEventBase & {
      type: "tool.call";
      messageId: MessageId;
      toolCallId: string;
      toolName: string;
      input: JsonValue;
    })
  | (RuntimeStreamEventBase & {
      type: "tool.result";
      messageId: MessageId;
      toolCallId: string;
      toolName: string;
      output: JsonValue;
      isError?: boolean;
    })
  | (RuntimeStreamEventBase & {
      type: "usage.updated";
      usage: TokenUsage;
    })
  | (RuntimeStreamEventBase & {
      type: "message.completed";
      messageId: MessageId;
    })
  | (RuntimeStreamEventBase & {
      type: "run.completed";
      usage?: TokenUsage;
    })
  | (RuntimeStreamEventBase & {
      type: "run.failed";
      error: RunError;
    });
