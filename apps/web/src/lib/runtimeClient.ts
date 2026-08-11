/** Talks to the authenticated loopback runtime without exposing provider secrets to Convex. */

import type { ChatMessage, ProviderId, ReasoningEffort } from "./conversation";

type DesktopBridge = {
  platform?: string;
  getRuntimeConfig: () => Promise<{ baseUrl: string; token: string }>;
  saveProviderSecret?: (provider: "openrouter", value: string) => void;
  onNewChat?: (callback: () => void) => void;
  offNewChat?: (callback: () => void) => void;
};

declare global {
  interface Window {
    monteCarloDesktop?: DesktopBridge;
  }
}

export type RuntimeStreamEvent =
  | { type: "start"; runId: string; provider: string; model?: string }
  | { type: "status"; status: "starting" | "waiting"; message: string }
  | { type: "output"; delta: string; stream: "stdout" | "stderr" }
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "provider-thread"; threadId: string }
  | { type: "usage"; usage: Record<string, number | undefined> }
  | { type: "finish"; finishReason?: string }
  | { type: "error"; message: string; code?: string; retryable?: boolean };

export type ProviderStatus = {
  id: string;
  name: string;
  auth: "local-subscription" | "api-key" | "none" | "unavailable";
  available: boolean;
  description: string;
  unavailableReason?: string;
  health: {
    status: "ready" | "needs-configuration" | "unavailable";
    authenticated?: boolean;
    detail: string;
  };
};

export type ProviderModel = {
  id: string;
  displayName: string;
  description?: string;
  reasoningEfforts?: ReasoningEffort[];
  supportsFastMode?: boolean;
};

export type ProviderModelCatalog = {
  provider: ProviderId;
  models: ProviderModel[];
  source: "cli" | "endpoint" | "curated";
  fetchedAt: number;
};

type EndpointProvider = "openrouter" | "ollama";

function endpointStorageKey(provider: EndpointProvider): string {
  return `monte-carlo:provider:${provider}:base-url`;
}

export function getProviderEndpoint(provider: EndpointProvider): string {
  try {
    return localStorage.getItem(endpointStorageKey(provider)) ?? "";
  } catch {
    return "";
  }
}

export function saveProviderEndpoint(provider: EndpointProvider, rawValue: string): string {
  const value = rawValue.trim().replace(/\/$/u, "");
  if (!value) {
    localStorage.removeItem(endpointStorageKey(provider));
    return "";
  }
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Provider endpoints may not include credentials, query strings, or fragments.");
  }
  if (provider === "openrouter" && url.protocol !== "https:") {
    throw new Error("OpenRouter-compatible endpoints must use HTTPS.");
  }
  if (provider === "ollama") {
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    if (!loopback || (url.protocol !== "http:" && url.protocol !== "https:")) {
      throw new Error("Ollama endpoints must be loopback HTTP(S) URLs.");
    }
  }
  localStorage.setItem(endpointStorageKey(provider), value);
  return value;
}

export const MESSAGE_ENVELOPE_VERSION = 1 as const;
export const MESSAGE_ENVELOPE_CONTENT_TYPE = "application/json" as const;

type MessageEnvelopeV1 = {
  version: typeof MESSAGE_ENVELOPE_VERSION;
  content: string;
};

export type EncodedMessageEnvelope = {
  data: Uint8Array<ArrayBuffer>;
  byteLength: number;
  sha256: string;
};

type RuntimeBlobManifest = {
  version: number;
  backend: "filesystem" | "r2";
  key: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  envelopeVersion: number;
};

async function runtimeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = await runtimeConfig();
  const headers = new Headers(init.headers);
  if (config.token) headers.set("authorization", `Bearer ${config.token}`);
  return fetch(`${config.baseUrl}${path}`, { ...init, headers });
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function encodeMessageEnvelope(content: string): Promise<EncodedMessageEnvelope> {
  const envelope: MessageEnvelopeV1 = { version: MESSAGE_ENVELOPE_VERSION, content };
  const data = new TextEncoder().encode(JSON.stringify(envelope));
  return { data, byteLength: data.byteLength, sha256: await sha256Hex(data) };
}

export async function putRuntimeBlob(input: {
  manifestId: string;
  objectKey: string;
  backend: "filesystem" | "r2";
  data: Uint8Array<ArrayBuffer>;
  byteLength: number;
  sha256: string;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await runtimeFetch(`/v1/blobs/${encodeURIComponent(input.objectKey)}`, {
    method: "PUT",
    headers: {
      "content-type": MESSAGE_ENVELOPE_CONTENT_TYPE,
      "x-montecarlo-storage-backend": input.backend,
      "x-montecarlo-envelope-version": String(MESSAGE_ENVELOPE_VERSION),
      "x-montecarlo-sha256": input.sha256,
      "x-montecarlo-manifest-id": input.manifestId,
    },
    body: input.data,
    signal: input.signal,
  });
  if (!response.ok) throw new Error(`Runtime returned ${response.status}`);

  const body = (await response.json()) as { manifest?: RuntimeBlobManifest; attestation?: string };
  const manifest = body.manifest;
  if (
    manifest?.version !== 1 ||
    manifest.backend !== input.backend ||
    manifest.key !== input.objectKey ||
    manifest.sha256.toLowerCase() !== input.sha256 ||
    manifest.byteLength !== input.byteLength ||
    manifest.mediaType !== MESSAGE_ENVELOPE_CONTENT_TYPE ||
    manifest.envelopeVersion !== MESSAGE_ENVELOPE_VERSION
  ) {
    throw new Error("Runtime blob manifest did not match the reserved content.");
  }
  if (!/^[A-Za-z0-9_-]{86}$/u.test(body.attestation ?? "")) {
    throw new Error("Runtime did not attest the stored blob.");
  }
  return body.attestation as string;
}

export async function getRuntimeMessageContent(input: {
  objectKey: string;
  backend: "filesystem" | "r2";
  envelopeVersion: number;
  byteLength: number;
  sha256: string;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await runtimeFetch(`/v1/blobs/${encodeURIComponent(input.objectKey)}`, {
    headers: { "x-montecarlo-storage-backend": input.backend },
    signal: input.signal,
  });
  if (!response.ok) throw new Error(`Runtime returned ${response.status}`);

  const data = new Uint8Array(await response.arrayBuffer());
  const digest = await sha256Hex(data);
  const responseDigest = response.headers.get("x-montecarlo-sha256")?.toLowerCase();
  const responseEnvelopeVersion = response.headers.get("x-montecarlo-envelope-version");
  if (input.envelopeVersion !== MESSAGE_ENVELOPE_VERSION) {
    throw new Error(`Unsupported message envelope version ${input.envelopeVersion}.`);
  }
  if (
    data.byteLength !== input.byteLength ||
    digest !== input.sha256.toLowerCase() ||
    (responseDigest !== undefined && responseDigest !== input.sha256.toLowerCase()) ||
    (responseEnvelopeVersion !== null && responseEnvelopeVersion !== String(input.envelopeVersion))
  ) {
    throw new Error("Runtime message content failed integrity verification.");
  }

  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(data);
  const envelope = JSON.parse(decoded) as Partial<MessageEnvelopeV1>;
  if (envelope.version !== MESSAGE_ENVELOPE_VERSION || typeof envelope.content !== "string") {
    throw new Error("Runtime message content uses an unsupported envelope.");
  }
  return envelope.content;
}

export async function getRuntimeProviders(): Promise<ProviderStatus[]> {
  const response = await runtimeFetch("/v1/providers");
  if (!response.ok) throw new Error(`Runtime returned ${response.status}`);
  const body = (await response.json()) as { providers: ProviderStatus[] };
  return body.providers;
}

function modelCatalogStorageKey(provider: ProviderId): string {
  return `monte-carlo:provider:${provider}:model-catalog`;
}

type StoredModelCatalog = ProviderModelCatalog & { connectionBaseURL?: string };

export function getCachedModelCatalog(
  provider: ProviderId,
  connectionBaseURL?: string,
): ProviderModelCatalog | undefined {
  if (provider === "openrouter") return undefined;
  try {
    const raw = localStorage.getItem(modelCatalogStorageKey(provider));
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as StoredModelCatalog;
    if (
      cached.provider !== provider ||
      !Array.isArray(cached.models) ||
      !cached.models.every(
        (model) => typeof model.id === "string" && typeof model.displayName === "string",
      ) ||
      !["cli", "endpoint", "curated"].includes(cached.source) ||
      typeof cached.fetchedAt !== "number" ||
      cached.connectionBaseURL !== connectionBaseURL
    ) {
      return undefined;
    }
    return cached;
  } catch {
    return undefined;
  }
}

export async function getRuntimeModelCatalog(
  provider: Exclude<ProviderId, "openrouter">,
  connectionBaseURL?: string,
): Promise<ProviderModelCatalog> {
  const response = await runtimeFetch("/v1/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider,
      connection: connectionBaseURL ? { baseURL: connectionBaseURL } : undefined,
    }),
  });
  if (!response.ok) throw new Error(`Runtime returned ${response.status}`);
  const catalog = (await response.json()) as ProviderModelCatalog;
  try {
    localStorage.setItem(
      modelCatalogStorageKey(provider),
      JSON.stringify({ ...catalog, connectionBaseURL } satisfies StoredModelCatalog),
    );
  } catch {
    // Catalog caching is an optional performance optimization.
  }
  return catalog;
}

export async function saveProviderSecret(provider: "openrouter", value: string): Promise<void> {
  if (!window.monteCarloDesktop?.saveProviderSecret) {
    throw new Error("Provider keys can only be saved securely in the desktop app.");
  }
  await window.monteCarloDesktop.saveProviderSecret(provider, value);
}

export async function startCodexDeviceLogin(
  signal: AbortSignal,
  onEvent: (event: RuntimeStreamEvent) => void,
): Promise<void> {
  const response = await runtimeFetch("/v1/auth/codex/device-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "device" }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Runtime returned ${response.status}`);
  await consumeEventStream(response.body, onEvent);
}

export async function startClaudeLogin(
  signal: AbortSignal,
  onEvent: (event: RuntimeStreamEvent) => void,
): Promise<void> {
  const response = await runtimeFetch("/v1/auth/anthropic/device-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "device" }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Runtime returned ${response.status}`);
  await consumeEventStream(response.body, onEvent);
}

async function runtimeConfig(): Promise<{ baseUrl: string; token?: string }> {
  if (window.monteCarloDesktop) return window.monteCarloDesktop.getRuntimeConfig();
  const rawBaseUrl = import.meta.env.VITE_RUNTIME_URL || "http://127.0.0.1:4242";
  const url = new URL(rawBaseUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (
    !loopback ||
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("The current web build only supports a loopback companion runtime.");
  }
  return {
    baseUrl: url.toString().replace(/\/$/u, ""),
    token: import.meta.env.DEV ? import.meta.env.VITE_RUNTIME_TOKEN : undefined,
  };
}

export function parseEventBlock(block: string): RuntimeStreamEvent | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;
  try {
    return JSON.parse(data) as RuntimeStreamEvent;
  } catch {
    return undefined;
  }
}

export async function streamRuntimeChat(input: {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  prompt: string;
  reasoningEffort: ReasoningEffort;
  fastMode: boolean;
  signal: AbortSignal;
  onEvent: (event: RuntimeStreamEvent) => void;
}): Promise<void> {
  const baseURL =
    input.provider === "openrouter" || input.provider === "ollama"
      ? getProviderEndpoint(input.provider)
      : "";
  const response = await runtimeFetch("/v1/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provider: input.provider,
      model: input.model,
      messages: [
        ...input.messages.map(({ role, content }) => ({ role, content })),
        { role: "user", content: input.prompt },
      ],
      connection: baseURL ? { baseURL } : undefined,
      options: {
        reasoningEffort: input.reasoningEffort,
        fastMode: input.fastMode,
      },
    }),
    signal: input.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Runtime returned ${response.status}`);
  }

  await consumeEventStream(response.body, input.onEvent);
}

async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: RuntimeStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseEventBlock(block);
      if (event) onEvent(event);
    }
    if (done) break;
  }
  const finalEvent = parseEventBlock(buffer);
  if (finalEvent) onEvent(finalEvent);
}
