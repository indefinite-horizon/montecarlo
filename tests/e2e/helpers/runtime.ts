/** Deterministic loopback-runtime replacement for browser E2E tests. */

import { createPrivateKey, sign } from "node:crypto";
import type { BrowserContext, Page, Request, Route } from "@playwright/test";

export type RuntimeChatRequest = {
  provider: "codex" | "anthropic" | "ollama" | "openrouter";
  model: string;
  messages: Array<{ role: string; content: string }>;
  connection?: { baseURL?: string };
  options?: {
    reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
    fastMode?: boolean;
  };
};

export type RuntimeMock = {
  chatRequests: RuntimeChatRequest[];
  blobs: Map<string, Buffer>;
  blobBackends: Map<string, "filesystem" | "r2">;
  blobReads: Array<{ objectKey: string; backend: "filesystem" | "r2" }>;
};

export type ControlledRuntimeStream = {
  marker: string;
  waitForRequest: (page: Page) => Promise<void>;
  releaseText: (page: Page, delta: string) => Promise<void>;
  finish: (page: Page, finishReason?: string) => Promise<void>;
};

const runtimeOrigin = new URL(process.env.VITE_RUNTIME_URL ?? "http://127.0.0.1:4242").origin;
const runtimePattern = `${runtimeOrigin}/**`;
const controlledStreamRegistryKey = "__monteCarloControlledRuntimeStreams";
const envelopeContentType = "application/json";
const e2eBlobAttestationPrivateKey =
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg7h5Hg/B7z8jrBZYTmh0eS56pB+NXXpmNi1CMAU8+cSihRANCAAQ9vrH0LB1nEP/VPXJHSQ3qiFxK4u2MQgVG42RWgiEUpLLWJADAcSqdPVswzW1QeMTLYdekVAmkeEHrnr4Maa/l";

function corsHeaders(contentType = "application/json") {
  return {
    "access-control-allow-headers":
      "authorization,content-type,x-montecarlo-envelope-version,x-montecarlo-manifest-id,x-montecarlo-sha256,x-montecarlo-storage-backend",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": contentType,
  };
}

function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: corsHeaders(),
    body: JSON.stringify(value),
  });
}

function latestPrompt(input: RuntimeChatRequest): string {
  return [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function responseText(prompt: string): string {
  if (isChatTitlePrompt(prompt)) {
    const encodedIntent = prompt.match(/<user_intent>(.+)<\/user_intent>/u)?.[1];
    if (!encodedIntent) return "Generated Chat Title";
    try {
      return String(JSON.parse(encodedIntent)).trim().split(/\s+/u).slice(0, 7).join(" ");
    } catch {
      return "Generated Chat Title";
    }
  }
  const markerStart = prompt.indexOf("[reply:");
  const markerEnd = markerStart >= 0 ? prompt.indexOf("]", markerStart) : -1;
  const marker = markerEnd > markerStart ? prompt.slice(markerStart + 7, markerEnd) : undefined;
  const visiblePrompt = prompt.replaceAll("[e2e:slow]", "").replaceAll("[e2e:error]", "").trim();
  return marker ?? `Stub response: ${visiblePrompt}`;
}

export function isChatTitlePrompt(prompt: string): boolean {
  return prompt.startsWith("Create a concise chat name that captures the user's intent.");
}

export function conversationRequests(state: RuntimeMock): RuntimeChatRequest[] {
  return state.chatRequests.filter((request) => !isChatTitlePrompt(latestPrompt(request)));
}

export function titleRequests(state: RuntimeMock): RuntimeChatRequest[] {
  return state.chatRequests.filter((request) => isChatTitlePrompt(latestPrompt(request)));
}

/**
 * Installs a browser-local chat response whose SSE chunks are released by the test.
 * Playwright buffers Route.fulfill bodies, so a browser ReadableStream is required to
 * exercise layout changes between individual text-delta events.
 */
export async function installControlledRuntimeStream(
  context: BrowserContext,
  marker = "[e2e:controlled-stream]",
): Promise<ControlledRuntimeStream> {
  await context.addInitScript(
    ({ registryKey, requestMarker }) => {
      type ControlledState = {
        closed: boolean;
        marker: string;
        requestCount: number;
        requestStarted: boolean;
        writer?: WritableStreamDefaultWriter<Uint8Array>;
      };
      type ControlledRegistry = {
        originalFetch: typeof window.fetch;
        streams: Record<string, ControlledState>;
      };

      let registry = Reflect.get(window, registryKey) as ControlledRegistry | undefined;
      if (!registry) {
        const createdRegistry: ControlledRegistry = {
          originalFetch: window.fetch.bind(window),
          streams: {},
        };
        registry = createdRegistry;
        Reflect.set(window, registryKey, createdRegistry);

        window.fetch = async (input, init) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          if (new URL(url, window.location.href).pathname !== "/v1/chat") {
            return createdRegistry.originalFetch(input, init);
          }

          let body = "";
          if (typeof init?.body === "string") {
            body = init.body;
          } else if (input instanceof Request) {
            body = await input.clone().text();
          } else if (init?.body) {
            body = await new Response(init.body).text();
          }
          let request: {
            messages?: Array<{ content?: string; role?: string }>;
            provider?: string;
          };
          try {
            request = JSON.parse(body) as typeof request;
          } catch {
            return createdRegistry.originalFetch(input, init);
          }
          const prompt = [...(request.messages ?? [])]
            .reverse()
            .find((message) => message.role === "user")?.content;
          const state = Object.values(createdRegistry.streams).find((candidate) =>
            prompt?.includes(candidate.marker),
          );
          if (!state || prompt?.startsWith("Create a concise chat name")) {
            return createdRegistry.originalFetch(input, init);
          }

          const encodeEvent = (event: unknown) =>
            new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
          const stream = new TransformStream<Uint8Array, Uint8Array>();
          const writer = stream.writable.getWriter();
          state.writer = writer;
          state.closed = false;
          state.requestCount += 1;
          state.requestStarted = true;
          void writer
            .write(
              encodeEvent({
                type: "start",
                runId: `run-controlled-${state.requestCount}`,
                provider: request.provider ?? "codex",
              }),
            )
            .catch(() => undefined);
          const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
          const abortStream = () => {
            state.closed = true;
            void state.writer?.abort(new DOMException("The operation was aborted.", "AbortError"));
            state.writer = undefined;
          };
          if (signal?.aborted) abortStream();
          else signal?.addEventListener("abort", abortStream, { once: true });
          return new Response(stream.readable, {
            status: 200,
            headers: {
              "access-control-allow-origin": "*",
              "content-type": "text/event-stream",
            },
          });
        };
      }

      if (registry.streams[requestMarker]) {
        throw new Error(`A controlled runtime stream already uses marker ${requestMarker}.`);
      }
      registry.streams[requestMarker] = {
        closed: false,
        marker: requestMarker,
        requestCount: 0,
        requestStarted: false,
      };
    },
    { registryKey: controlledStreamRegistryKey, requestMarker: marker },
  );

  const waitForRequest = async (page: Page) => {
    await page.waitForFunction(
      ({ registryKey, requestMarker }) => {
        const registry = Reflect.get(window, registryKey) as
          | { streams?: Record<string, { requestStarted?: boolean }> }
          | undefined;
        return registry?.streams?.[requestMarker]?.requestStarted === true;
      },
      { registryKey: controlledStreamRegistryKey, requestMarker: marker },
    );
  };

  const releaseText = async (page: Page, delta: string) => {
    await page.evaluate(
      async ({ registryKey, requestMarker, text }) => {
        const registry = Reflect.get(window, registryKey) as
          | {
              streams?: Record<
                string,
                {
                  closed: boolean;
                  requestCount: number;
                  writer?: WritableStreamDefaultWriter<Uint8Array>;
                }
              >;
            }
          | undefined;
        const state = registry?.streams?.[requestMarker];
        if (!state?.writer || state.closed) {
          throw new Error("The controlled runtime stream is not open.");
        }
        if (state.requestCount !== 1) {
          throw new Error(
            `Expected one controlled runtime request, received ${state.requestCount}.`,
          );
        }
        await state.writer.write(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ type: "text-delta", delta: text })}\n\n`,
          ),
        );
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      },
      { registryKey: controlledStreamRegistryKey, requestMarker: marker, text: delta },
    );
  };

  const finish = async (page: Page, finishReason = "stop") => {
    await page.evaluate(
      async ({ reason, registryKey, requestMarker }) => {
        const registry = Reflect.get(window, registryKey) as
          | {
              streams?: Record<
                string,
                {
                  closed: boolean;
                  requestCount: number;
                  writer?: WritableStreamDefaultWriter<Uint8Array>;
                }
              >;
            }
          | undefined;
        const state = registry?.streams?.[requestMarker];
        if (!state?.writer || state.closed) {
          throw new Error("The controlled runtime stream is not open.");
        }
        if (state.requestCount !== 1) {
          throw new Error(
            `Expected one controlled runtime request, received ${state.requestCount}.`,
          );
        }
        await state.writer.write(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ type: "finish", finishReason: reason })}\n\n`,
          ),
        );
        await state.writer.close();
        state.closed = true;
        state.writer = undefined;
      },
      { reason: finishReason, registryKey: controlledStreamRegistryKey, requestMarker: marker },
    );
  };

  return { marker, waitForRequest, releaseText, finish };
}

async function handleChat(route: Route, request: Request, state: RuntimeMock) {
  const input = request.postDataJSON() as RuntimeChatRequest;
  state.chatRequests.push(input);
  const prompt = latestPrompt(input);

  if (prompt.includes("[e2e:error]")) {
    await json(
      route,
      { error: { code: "provider_error", message: "Injected provider error" } },
      503,
    );
    return;
  }

  if (prompt.includes("[e2e:slow]")) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const content = responseText(prompt);
  const midpoint = Math.max(1, Math.floor(content.length / 2));
  const events = [
    { type: "start", runId: `run-${state.chatRequests.length}`, provider: input.provider },
    { type: "text-delta", delta: content.slice(0, midpoint) },
    { type: "text-delta", delta: content.slice(midpoint) },
    { type: "finish", finishReason: "stop" },
  ];
  try {
    await route.fulfill({
      status: 200,
      headers: corsHeaders("text/event-stream"),
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  } catch {
    // A cancellation can dispose the intercepted route before the delayed response is fulfilled.
  }
}

async function handlePutBlob(
  route: Route,
  request: Request,
  state: RuntimeMock,
  objectKey: string,
) {
  const body = request.postDataBuffer() ?? Buffer.alloc(0);
  const headers = request.headers();
  const backend = headers["x-montecarlo-storage-backend"];
  const envelopeVersion = Number(headers["x-montecarlo-envelope-version"]);
  const sha256 = headers["x-montecarlo-sha256"];
  const manifestId = headers["x-montecarlo-manifest-id"];
  if (backend !== "filesystem" && backend !== "r2") {
    await json(route, { error: "invalid storage backend" }, 400);
    return;
  }
  const payload = [
    manifestId,
    backend,
    objectKey,
    sha256,
    body.byteLength,
    envelopeVersion,
    envelopeContentType,
  ].join("\n");
  const key = createPrivateKey({
    key: Buffer.from(e2eBlobAttestationPrivateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const attestation = sign("sha256", Buffer.from(payload), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  state.blobs.set(objectKey, body);
  state.blobBackends.set(objectKey, backend);
  await json(route, {
    manifest: {
      version: 1,
      backend,
      key: objectKey,
      sha256,
      byteLength: body.byteLength,
      mediaType: envelopeContentType,
      envelopeVersion,
    },
    attestation,
  });
}

async function handleRuntimeRoute(route: Route, state: RuntimeMock) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders() });
    return;
  }
  const url = new URL(request.url());
  if (url.pathname === "/v1/chat" && request.method() === "POST") {
    await handleChat(route, request, state);
    return;
  }
  if (url.pathname === "/v1/providers" && request.method() === "GET") {
    await json(route, {
      providers: [
        runtimeProvider("codex", "local-subscription", "ready"),
        runtimeProvider("anthropic", "local-subscription", "ready"),
        runtimeProvider("ollama", "none", "ready"),
        runtimeProvider("openrouter", "api-key", "ready"),
      ],
    });
    return;
  }
  if (url.pathname === "/v1/models" && request.method() === "POST") {
    const provider = (request.postDataJSON() as { provider: RuntimeChatRequest["provider"] })
      .provider;
    const models = {
      codex: [
        {
          id: "e2e-codex",
          displayName: "E2E Codex",
          reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
          supportsFastMode: true,
        },
      ],
      anthropic: [{ id: "e2e-claude", displayName: "E2E Claude" }],
      ollama: [{ id: "e2e-ollama", displayName: "E2E Ollama" }],
      openrouter: [],
    }[provider];
    await json(route, { provider, models, source: "cli", fetchedAt: Date.now() });
    return;
  }
  if (url.pathname.startsWith("/v1/auth/anthropic/")) {
    await json(route, { status: "ready", authenticated: true, detail: "E2E fixture" });
    return;
  }
  const blobPrefix = "/v1/blobs/";
  if (url.pathname.startsWith(blobPrefix)) {
    const objectKey = decodeURIComponent(url.pathname.slice(blobPrefix.length));
    if (request.method() === "PUT") {
      await handlePutBlob(route, request, state, objectKey);
      return;
    }
    const body = state.blobs.get(objectKey);
    const backend = state.blobBackends.get(objectKey);
    if (!body || !backend) {
      await json(route, { error: "not found" }, 404);
      return;
    }
    if (request.headers()["x-montecarlo-storage-backend"] !== backend) {
      await json(route, { error: "storage backend mismatch" }, 409);
      return;
    }
    state.blobReads.push({ objectKey, backend });
    await route.fulfill({
      status: 200,
      headers: {
        ...corsHeaders(envelopeContentType),
        "x-montecarlo-envelope-version": "1",
        "x-montecarlo-sha256": objectKey.split("/").at(-1) ?? "",
        "x-montecarlo-storage-backend": backend,
      },
      body,
    });
    return;
  }
  await json(route, { error: "not found" }, 404);
}

function runtimeProvider(
  id: string,
  auth: "local-subscription" | "api-key" | "none",
  status: "ready" | "needs-configuration",
) {
  return {
    id,
    name: id,
    auth,
    available: status === "ready",
    description: "Deterministic E2E runtime",
    health: { status, authenticated: status === "ready", detail: "E2E fixture" },
  };
}

export async function installRuntimeMock(context: BrowserContext): Promise<RuntimeMock> {
  const state: RuntimeMock = {
    chatRequests: [],
    blobs: new Map(),
    blobBackends: new Map(),
    blobReads: [],
  };
  await context.route(runtimePattern, (route) => handleRuntimeRoute(route, state));
  return state;
}
