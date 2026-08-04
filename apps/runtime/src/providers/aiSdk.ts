/** Adapts AI SDK 7 providers to the normalized local runner contract. */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel, type LanguageModelUsage, streamText } from "ai";
import { runtimeDefaults } from "../config.js";
import type {
  ChatMessage,
  ChatRequest,
  ProviderDescriptor,
  ProviderHealth,
  Runner,
  RunnerEvent,
  TokenUsage,
} from "../types.js";
import { resolveOllamaBaseURL, resolveOpenRouterBaseURL } from "../validation.js";

interface AiSdkRunnerOptions {
  descriptor: ProviderDescriptor;
  createModel: (input: ChatRequest) => LanguageModel;
  health: (signal?: AbortSignal) => Promise<ProviderHealth>;
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

export class AiSdkRunner implements Runner {
  readonly descriptor: ProviderDescriptor;
  private readonly createModel: AiSdkRunnerOptions["createModel"];
  private readonly getHealth: AiSdkRunnerOptions["health"];

  constructor(options: AiSdkRunnerOptions) {
    this.descriptor = options.descriptor;
    this.createModel = options.createModel;
    this.getHealth = options.health;
  }

  health(signal?: AbortSignal): Promise<ProviderHealth> {
    return this.getHealth(signal);
  }

  async *run(input: ChatRequest, signal: AbortSignal): AsyncIterable<RunnerEvent> {
    const result = streamText({
      model: this.createModel(input),
      messages: toModelMessages(input.messages),
      abortSignal: signal,
      maxOutputTokens: input.options?.maxOutputTokens,
      temperature: input.options?.temperature,
    });

    for await (const part of result.stream) {
      switch (part.type) {
        case "text-delta":
          if (part.text !== "") yield { type: "text-delta", delta: part.text };
          break;
        case "reasoning-delta":
          if (part.text !== "") yield { type: "reasoning-delta", delta: part.text };
          break;
        case "finish":
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
  const userApiKey = env.MONTE_CARLO_USER_OPENROUTER_API_KEY?.trim();
  const managedApiKey =
    env.MONTE_CARLO_MANAGED_OPENROUTER_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim();
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
    createModel: (input) =>
      createOpenAICompatible({
        name: "ollama",
        baseURL: resolveOllamaBaseURL(input.connection?.baseURL ?? configuredBaseURL),
        includeUsage: true,
      })(input.model),
  });
}
