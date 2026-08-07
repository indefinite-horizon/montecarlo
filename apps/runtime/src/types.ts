/** Defines normalized provider, request, health, and streaming event contracts. */

export const providerIds = ["codex", "openrouter", "ollama", "anthropic"] as const;
export const reasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ProviderId = (typeof providerIds)[number];
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export type MessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ProviderConnection {
  apiKey?: string;
  baseURL?: string;
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  providerThreadId?: string;
  connection?: ProviderConnection;
  options?: {
    maxOutputTokens?: number;
    temperature?: number;
    reasoningEffort?: ReasoningEffort;
    fastMode?: boolean;
  };
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export type RunnerEvent =
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "provider-thread"; threadId: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "finish"; finishReason: string; usage?: TokenUsage };

export type ChatStreamEvent =
  | { type: "start"; runId: string; provider: ProviderId; model: string }
  | RunnerEvent
  | { type: "error"; code: string; message: string; retryable: boolean };

export type ProviderHealthStatus = "ready" | "needs-configuration" | "unavailable";

export interface ProviderHealth {
  status: ProviderHealthStatus;
  authenticated?: boolean;
  detail: string;
}

export interface ProviderModel {
  id: string;
  displayName: string;
  description?: string;
  reasoningEfforts?: ReasoningEffort[];
  supportsFastMode?: boolean;
}

export interface ProviderModelCatalog {
  provider: ProviderId;
  models: ProviderModel[];
  source: "cli" | "endpoint" | "curated";
  fetchedAt: number;
}

export interface ModelCatalogRequest {
  provider: ProviderId;
  connection?: Pick<ProviderConnection, "baseURL">;
}

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  auth: "local-subscription" | "api-key" | "none" | "unavailable";
  available: boolean;
  description: string;
  unavailableReason?: string;
}

export interface Runner {
  readonly descriptor: ProviderDescriptor;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  listModels?(
    connection?: Pick<ProviderConnection, "baseURL">,
    signal?: AbortSignal,
  ): Promise<ProviderModelCatalog>;
  run(input: ChatRequest, signal: AbortSignal): AsyncIterable<RunnerEvent>;
}

export type AuthEvent =
  | { type: "status"; status: "starting" | "waiting"; message: string }
  | { type: "output"; delta: string; stream: "stdout" | "stderr" }
  | { type: "finish"; success: true };

export interface LocalAuthRunner extends Runner {
  authStatus(signal?: AbortSignal): Promise<ProviderHealth>;
  deviceLogin(signal: AbortSignal): AsyncIterable<AuthEvent>;
}

export function hasLocalAuth(runner: Runner): runner is LocalAuthRunner {
  const candidate = runner as Partial<LocalAuthRunner>;
  return typeof candidate.authStatus === "function" && typeof candidate.deviceLogin === "function";
}
