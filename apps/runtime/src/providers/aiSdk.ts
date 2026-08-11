/** Adapts AI SDK 7 providers to the normalized local runner contract. */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  type LanguageModel,
  type LanguageModelUsage,
  streamText,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import { runtimeDefaults } from "../config.js";
import type {
  ChatMessage,
  ChatRequest,
  ProviderDescriptor,
  ProviderHealth,
  ProviderId,
  ProviderModelCatalog,
  ReasoningEffort,
  Runner,
  RunnerEvent,
  TokenUsage,
} from "../types.js";
import { resolveOllamaBaseURL, resolveOpenRouterBaseURL } from "../validation.js";

interface AiSdkRunnerOptions {
  descriptor: ProviderDescriptor;
  createModel: (input: ChatRequest) => LanguageModel;
  health: (signal?: AbortSignal) => Promise<ProviderHealth>;
  listModels?: Runner["listModels"];
}

function toModelMessages(messages: ChatMessage[]) {
  return messages.map((message) => {
    if (message.role === "system") return { role: "system" as const, content: message.content };
    if (message.role === "user") return { role: "user" as const, content: message.content };
    return { role: "assistant" as const, content: message.content };
  });
}

function toTokenUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
  };
}

export function aiSdkReasoningEffort(
  provider: ProviderId,
  reasoningEffort?: ReasoningEffort,
): ReasoningEffort | undefined {
  if (provider === "ollama" && (reasoningEffort === "xhigh" || reasoningEffort === "max")) {
    return "high";
  }
  if (provider === "ollama" && reasoningEffort === "minimal") return "low";
  return reasoningEffort;
}

export async function* normalizeAiSdkStream<TOOLS extends ToolSet>(
  parts: AsyncIterable<TextStreamPart<TOOLS>>,
): AsyncIterable<RunnerEvent> {
  let hasVisibleText = false;
  for await (const part of parts) {
    switch (part.type) {
      case "text-delta":
        if (part.text !== "") {
          hasVisibleText = true;
          yield { type: "text-delta", delta: part.text };
        }
        break;
      case "reasoning-delta":
        if (part.text !== "") yield { type: "reasoning-delta", delta: part.text };
        break;
      case "finish":
        if (!hasVisibleText) {
          throw new Error("The provider finished without a text response.");
        }
        yield {
          type: "finish",
          finishReason: part.finishReason,
          usage: toTokenUsage(part.totalUsage),
        };
        break;
      case "abort":
        return;
      case "error":
        throw part.error;
    }
  }
}

export class AiSdkRunner implements Runner {
  readonly descriptor: ProviderDescriptor;
  private readonly createModel: AiSdkRunnerOptions["createModel"];
  private readonly getHealth: AiSdkRunnerOptions["health"];
  readonly listModels?: Runner["listModels"];

  constructor(options: AiSdkRunnerOptions) {
    this.descriptor = options.descriptor;
    this.createModel = options.createModel;
    this.getHealth = options.health;
    this.listModels = options.listModels;
  }

  health(signal?: AbortSignal): Promise<ProviderHealth> {
    return this.getHealth(signal);
  }

  async *run(input: ChatRequest, signal: AbortSignal): AsyncIterable<RunnerEvent> {
    const reasoningEffort = aiSdkReasoningEffort(
      this.descriptor.id,
      input.options?.reasoningEffort,
    );
    const result = streamText({
      model: this.createModel(input),
      messages: toModelMessages(input.messages),
      abortSignal: signal,
      maxOutputTokens: input.options?.maxOutputTokens,
      temperature: input.options?.temperature,
      providerOptions: reasoningEffort ? { [this.descriptor.id]: { reasoningEffort } } : undefined,
    });

    yield* normalizeAiSdkStream(result.stream);
  }
}

function configuredHealth(configured: boolean, label: string): Promise<ProviderHealth> {
  return Promise.resolve(
    configured
      ? { status: "ready", authenticated: true, detail: `${label} is configured.` }
      : {
          status: "needs-configuration",
          authenticated: false,
          detail: `Provide an API key per request or configure ${label}.`,
        },
  );
}

export function createOpenRouterRunner(env: NodeJS.ProcessEnv = process.env): Runner {
  const userApiKey = env.MONTECARLO_USER_OPENROUTER_API_KEY?.trim();
  const managedApiKey =
    env.MONTECARLO_MANAGED_OPENROUTER_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim();
  return new AiSdkRunner({
    descriptor: {
      id: "openrouter",
      name: "OpenRouter",
      auth: "api-key",
      available: true,
      description: "OpenRouter models through a user-provided or locally managed API key.",
    },
    health: () => configuredHealth(Boolean(userApiKey || managedApiKey), "OpenRouter API key"),
    createModel: (input) => {
      const baseURL = resolveOpenRouterBaseURL(
        input.connection?.baseURL ?? env.OPENROUTER_BASE_URL,
      );
      const defaultBaseURL = resolveOpenRouterBaseURL(env.OPENROUTER_BASE_URL);
      // Never forward a centrally managed key to a request-selected endpoint.
      const apiKey =
        input.connection?.apiKey ??
        userApiKey ??
        (baseURL === defaultBaseURL ? managedApiKey : undefined);
      if (apiKey === undefined || apiKey === "") {
        throw new Error("An OpenRouter API key is required for this endpoint.");
      }
      return createOpenAICompatible({
        name: "openrouter",
        baseURL,
        apiKey,
        includeUsage: true,
      })(input.model);
    },
  });
}

export function createOllamaRunner(env: NodeJS.ProcessEnv = process.env): Runner {
  const configuredBaseURL = env.OLLAMA_BASE_URL ?? runtimeDefaults.ollamaBaseURL;
  return new AiSdkRunner({
    descriptor: {
      id: "ollama",
      name: "Ollama",
      auth: "none",
      available: true,
      description: "Models served by an Ollama instance on this machine.",
    },
    health: async (signal) => {
      try {
        const baseURL = resolveOllamaBaseURL(configuredBaseURL);
        const healthURL = new URL("/api/tags", `${baseURL}/`);
        const timeoutSignal = AbortSignal.timeout(runtimeDefaults.providerHealthTimeoutMs);
        const combinedSignal =
          signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
        const response = await fetch(healthURL, { method: "GET", signal: combinedSignal });
        return response.ok
          ? { status: "ready", detail: "Ollama is reachable." }
          : { status: "unavailable", detail: `Ollama returned HTTP ${response.status}.` };
      } catch {
        return { status: "unavailable", detail: "Ollama is not reachable on its local endpoint." };
      }
    },
    listModels: async (connection, signal): Promise<ProviderModelCatalog> => {
      const baseURL = resolveOllamaBaseURL(connection?.baseURL ?? configuredBaseURL);
      const modelsURL = new URL("/api/tags", `${baseURL}/`);
      const timeoutSignal = AbortSignal.timeout(runtimeDefaults.providerHealthTimeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(modelsURL, { method: "GET", signal: combinedSignal });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
      const body = (await response.json()) as { models?: unknown };
      const models = Array.isArray(body.models)
        ? body.models.flatMap((candidate) => {
            if (typeof candidate !== "object" || candidate === null) return [];
            const name = (candidate as { name?: unknown }).name;
            if (typeof name !== "string" || name.trim() === "") return [];
            return [{ id: name, displayName: name }];
          })
        : [];
      return { provider: "ollama", models, source: "endpoint", fetchedAt: Date.now() };
    },
    createModel: (input) =>
      createOpenAICompatible({
        name: "ollama",
        baseURL: resolveOllamaBaseURL(input.connection?.baseURL ?? configuredBaseURL),
        includeUsage: true,
      })(input.model),
  });
}
