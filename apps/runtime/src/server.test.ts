/** Exercises loopback runtime routing, security, streaming, and blob behavior. */

import { createHash, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeConfig } from "./config.js";
import { RunnerRegistry } from "./registry.js";
import { RuntimeServer } from "./server.js";
import {
  ObjectNotFoundError,
  type ObjectStoreBackend,
  type ObjectStoreV1,
  objectStoreContractVersion,
  type StoredObjectV1,
} from "./storage/types.js";
import type {
  AuthEvent,
  ChatRequest,
  LocalAuthRunner,
  ProviderDescriptor,
  ProviderHealth,
  Runner,
  RunnerEvent,
} from "./types.js";

const bearerToken = "test-runtime-token-that-is-longer-than-32-characters";
const { privateKey: blobAttestationPrivateKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const encodedBlobAttestationPrivateKey = blobAttestationPrivateKey
  .export({ format: "der", type: "pkcs8" })
  .toString("base64");
const runningServers: RuntimeServer[] = [];

function runtimeConfig(): RuntimeConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    development: false,
    bearerToken,
    allowedOrigins: new Set(["http://localhost:5173"]),
    blobAttestationPrivateKey: encodedBlobAttestationPrivateKey,
    maxRequestBytes: 2 * 1_024 * 1_024,
    maxBlobBytes: 32 * 1_024 * 1_024,
  };
}

function mockRunner(overrides: Partial<Runner> & { descriptor?: ProviderDescriptor } = {}): Runner {
  return {
    descriptor: {
      id: "openrouter",
      name: "Mock OpenRouter",
      auth: "api-key",
      available: true,
      description: "Mock provider",
    },
    health: () => Promise.resolve({ status: "ready", detail: "Mock is healthy." }),
    run: async function* () {
      yield { type: "text-delta", delta: "hello" };
      yield { type: "finish", finishReason: "stop" };
    },
    ...overrides,
  };
}

async function start(
  runners: Runner[],
  objectStore?: ObjectStoreV1,
  config: RuntimeConfig = runtimeConfig(),
): Promise<{ runtime: RuntimeServer; baseURL: string }> {
  const runtime = new RuntimeServer({
    config,
    registry: new RunnerRegistry(runners),
    objectStore,
  });
  runningServers.push(runtime);
  const address = await runtime.listen();
  return { runtime, baseURL: address.url };
}

async function startWithStores(
  runners: Runner[],
  objectStores: Partial<Record<ObjectStoreBackend, ObjectStoreV1>>,
): Promise<{ runtime: RuntimeServer; baseURL: string }> {
  const runtime = new RuntimeServer({
    config: runtimeConfig(),
    registry: new RunnerRegistry(runners),
    objectStores,
  });
  runningServers.push(runtime);
  const address = await runtime.listen();
  return { runtime, baseURL: address.url };
}

function memoryObjectStore(backend: ObjectStoreBackend = "filesystem"): ObjectStoreV1 {
  const objects = new Map<string, StoredObjectV1>();
  return {
    version: objectStoreContractVersion,
    backend,
    put: (input) => {
      const sha256 = createHash("sha256").update(input.data).digest("hex");
      const stored: StoredObjectV1 = {
        data: input.data,
        manifest: {
          version: objectStoreContractVersion,
          backend,
          key: input.key,
          sha256,
          byteLength: input.data.byteLength,
          mediaType: input.mediaType,
          envelopeVersion: input.envelopeVersion,
          storageVersion: sha256,
        },
      };
      objects.set(input.key, stored);
      return Promise.resolve(stored.manifest);
    },
    get: (key) => {
      const stored = objects.get(key);
      if (stored === undefined) return Promise.reject(new ObjectNotFoundError());
      return Promise.resolve(stored);
    },
  };
}

function requestHeaders(origin = "http://localhost:5173"): Record<string, string> {
  return { Authorization: `Bearer ${bearerToken}`, Origin: origin };
}

function chatBody(apiKey = "request-api-key"): ChatRequest {
  return {
    provider: "openrouter",
    model: "test/model",
    messages: [{ role: "user", content: "Hello" }],
    connection: { apiKey },
  };
}

function parseSse(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

afterEach(async () => {
  for (const runtime of runningServers.splice(0)) await runtime.close();
});

describe("RuntimeServer", () => {
  it("requires bearer auth and rejects untrusted browser origins", async () => {
    const { baseURL } = await start([mockRunner()]);

    const unauthorized = await fetch(`${baseURL}/v1/health`);
    expect(unauthorized.status).toBe(401);

    const forbidden = await fetch(`${baseURL}/v1/health`, {
      headers: requestHeaders("https://attacker.example"),
    });
    expect(forbidden.status).toBe(403);

    const healthy = await fetch(`${baseURL}/v1/health`, { headers: requestHeaders() });
    expect(healthy.status).toBe(200);
    await expect(healthy.json()).resolves.toMatchObject({
      status: "ready",
      service: "montecarlo-runtime",
    });
  });

  it("allows browser preflight for integrity-checked blob uploads", async () => {
    const { baseURL } = await start([mockRunner()]);
    const response = await fetch(`${baseURL}/v1/blobs/v1/workspaces/workspace_1/message.json`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers":
          "content-type,x-montecarlo-envelope-version,x-montecarlo-sha256,x-montecarlo-storage-backend",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "x-montecarlo-envelope-version",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "x-montecarlo-storage-backend",
    );
  });

  it("lists provider descriptors with health", async () => {
    const { baseURL } = await start([mockRunner()]);
    const response = await fetch(`${baseURL}/v1/providers`, { headers: requestHeaders() });
    const body = (await response.json()) as { providers: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.providers).toEqual([
      expect.objectContaining({
        id: "openrouter",
        health: { status: "ready", detail: "Mock is healthy." },
      }),
    ]);
  });

  it("returns a normalized model catalog from providers that support discovery", async () => {
    const runner = mockRunner({
      descriptor: {
        id: "ollama",
        name: "Mock Ollama",
        auth: "none",
        available: true,
        description: "Mock provider",
      },
      listModels: (_connection) =>
        Promise.resolve({
          provider: "ollama",
          models: [{ id: "qwen:test", displayName: "qwen:test" }],
          source: "endpoint",
          fetchedAt: 1,
        }),
    });
    const { baseURL } = await start([runner]);
    const response = await fetch(`${baseURL}/v1/models`, {
      method: "POST",
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "ollama",
        connection: { baseURL: "http://127.0.0.1:11434/v1" },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: "ollama",
      models: [{ id: "qwen:test" }],
      source: "endpoint",
    });
  });

  it("streams provider-neutral SSE events and redacts request credentials", async () => {
    const secret = "sk-secret-value-that-must-not-leak";
    const runner = mockRunner({
      run: async function* (_input: ChatRequest): AsyncIterable<RunnerEvent> {
        yield { type: "text-delta", delta: "A" };
        throw new Error(`Provider rejected ${secret}`);
      },
    });
    const { baseURL } = await start([runner]);
    const response = await fetch(`${baseURL}/v1/chat`, {
      method: "POST",
      headers: {
        ...requestHeaders(),
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chatBody(secret)),
    });
    const raw = await response.text();
    const events = parseSse(raw);

    expect(response.status).toBe(200);
    expect(events.map((event) => event.type)).toEqual(["start", "text-delta", "error", "finish"]);
    expect(events[1]).toMatchObject({ type: "text-delta", delta: "A" });
    expect(raw).not.toContain(secret);
    expect(raw).toContain("[redacted]");
  });

  it("cancels an active stream through its run id", async () => {
    const runner = mockRunner({
      run: async function* (_input: ChatRequest, signal: AbortSignal): AsyncIterable<RunnerEvent> {
        yield { type: "text-delta", delta: "before-cancel" };
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    });
    const { baseURL } = await start([runner]);
    const response = await fetch(`${baseURL}/v1/chat`, {
      method: "POST",
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(chatBody()),
    });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let raw = "";

    while (!raw.includes('"runId"')) {
      const chunk = await reader?.read();
      if (chunk?.done === true) break;
      raw += decoder.decode(chunk?.value, { stream: true });
    }
    const runId = /"runId":"([0-9a-f-]{36})"/.exec(raw)?.[1];
    expect(runId).toBeDefined();

    const cancellation = await fetch(`${baseURL}/v1/runs/${runId}/cancel`, {
      method: "POST",
      headers: requestHeaders(),
    });
    expect(cancellation.status).toBe(202);

    while (true) {
      const chunk = await reader?.read();
      if (chunk?.done === true || chunk === undefined) break;
      raw += decoder.decode(chunk.value, { stream: true });
    }
    expect(parseSse(raw)).toContainEqual({ type: "finish", finishReason: "cancelled" });
  });

  it("exposes Codex status and streams the official device-login connector", async () => {
    const descriptor: ProviderDescriptor = {
      id: "codex",
      name: "Mock Codex",
      auth: "local-subscription",
      available: true,
      description: "Mock Codex connector",
    };
    const authRunner: LocalAuthRunner = {
      descriptor,
      health: () => Promise.resolve({ status: "ready", detail: "ready" }),
      authStatus: (): Promise<ProviderHealth> =>
        Promise.resolve({ status: "ready", authenticated: true, detail: "signed in" }),
      run: async function* (): AsyncIterable<RunnerEvent> {
        yield { type: "finish", finishReason: "stop" };
      },
      deviceLogin: async function* (): AsyncIterable<AuthEvent> {
        yield { type: "output", delta: "Open the official verification page", stream: "stdout" };
        yield { type: "finish", success: true };
      },
    };
    const { baseURL } = await start([authRunner]);

    const status = await fetch(`${baseURL}/v1/auth/codex/status`, { headers: requestHeaders() });
    await expect(status.json()).resolves.toMatchObject({ authenticated: true });

    const login = await fetch(`${baseURL}/v1/auth/codex/device-login`, {
      method: "POST",
      headers: requestHeaders(),
    });
    const events = parseSse(await login.text());
    expect(events.map((event) => event.type)).toEqual(["start", "output", "finish"]);
  });

  it("stores and retrieves versioned blobs through authenticated endpoints", async () => {
    const store = memoryObjectStore();
    const { baseURL } = await start([mockRunner()], store);
    const key = "v1/workspaces/workspace_1/chats/chat_1/messages/message_1.json";
    const body = '{"version":1,"content":"hello"}';
    const digest = createHash("sha256").update(body).digest("hex");

    const put = await fetch(`${baseURL}/v1/blobs/${key}`, {
      method: "PUT",
      headers: {
        ...requestHeaders(),
        "Content-Type": "application/json",
        "X-Montecarlo-Envelope-Version": "1",
        "X-Montecarlo-SHA256": digest,
        "X-Montecarlo-Manifest-Id": "manifest_1",
      },
      body,
    });
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toMatchObject({
      manifest: {
        version: 1,
        backend: "filesystem",
        key,
        sha256: digest,
        envelopeVersion: 1,
      },
    });

    const get = await fetch(`${baseURL}/v1/blobs/${key}`, { headers: requestHeaders() });
    expect(get.status).toBe(200);
    expect(get.headers.get("x-montecarlo-sha256")).toBe(digest);
    expect(get.headers.get("x-montecarlo-envelope-version")).toBe("1");
    await expect(get.text()).resolves.toBe(body);
  });

  it("routes mixed local and cloud workspace blobs to their declared backends", async () => {
    const { baseURL } = await startWithStores([mockRunner()], {
      filesystem: memoryObjectStore("filesystem"),
      r2: memoryObjectStore("r2"),
    });
    const key = "v1/workspaces/workspace_cloud/objects/aa/message.json";
    const body = '{"version":1,"content":"cloud"}';
    const digest = createHash("sha256").update(body).digest("hex");
    const headers = {
      ...requestHeaders(),
      "Content-Type": "application/json",
      "X-Montecarlo-Envelope-Version": "1",
      "X-Montecarlo-SHA256": digest,
      "X-Montecarlo-Storage-Backend": "r2",
      "X-Montecarlo-Manifest-Id": "manifest_2",
    };

    const put = await fetch(`${baseURL}/v1/blobs/${key}`, { method: "PUT", headers, body });
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toMatchObject({ manifest: { backend: "r2" } });

    const get = await fetch(`${baseURL}/v1/blobs/${key}`, { headers });
    expect(get.status).toBe(200);
    expect(get.headers.get("x-montecarlo-storage-backend")).toBe("r2");
    await expect(get.text()).resolves.toBe(body);

    const missingHeader = await fetch(`${baseURL}/v1/blobs/${key}`, {
      headers: requestHeaders(),
    });
    expect(missingHeader.status).toBe(400);
  });

  it("enforces an optional workspace scope before accessing object storage", async () => {
    const store = memoryObjectStore();
    const config = { ...runtimeConfig(), allowedWorkspaceIds: new Set(["workspace_allowed"]) };
    const { baseURL } = await start([mockRunner()], store, config);
    const response = await fetch(
      `${baseURL}/v1/blobs/v1/workspaces/workspace_denied/messages/message_1.json`,
      { headers: requestHeaders() },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "workspace_not_allowed" },
    });
  });
});
