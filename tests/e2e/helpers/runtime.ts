/** Deterministic loopback-runtime replacement for browser E2E tests. */

import { createPrivateKey, sign } from "node:crypto";
import type { BrowserContext, Request, Route } from "@playwright/test";

export type RuntimeChatRequest = {
  provider: "codex" | "anthropic" | "ollama" | "openrouter";
  model: string;
  messages: Array<{ role: string; content: string }>;
  connection?: { baseURL?: string };
};

export type RuntimeMock = {
  chatRequests: RuntimeChatRequest[];
  blobs: Map<string, Buffer>;
};

const runtimeOrigin = new URL(process.env.VITE_RUNTIME_URL ?? "http://127.0.0.1:4242").origin;
const runtimePattern = `${runtimeOrigin}/**`;
const envelopeContentType = "application/json";
const e2eBlobAttestationPrivateKey =
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg7h5Hg/B7z8jrBZYTmh0eS56pB+NXXpmNi1CMAU8+cSihRANCAAQ9vrH0LB1nEP/VPXJHSQ3qiFxK4u2MQgVG42RWgiEUpLLWJADAcSqdPVswzW1QeMTLYdekVAmkeEHrnr4Maa/l";

function corsHeaders(contentType = "application/json") {
  return {
    "access-control-allow-headers":
      "authorization,content-type,x-monte-carlo-envelope-version,x-monte-carlo-manifest-id,x-monte-carlo-sha256,x-monte-carlo-storage-backend",
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
  const markerStart = prompt.indexOf("[reply:");
  const markerEnd = markerStart >= 0 ? prompt.indexOf("]", markerStart) : -1;
  const marker = markerEnd > markerStart ? prompt.slice(markerStart + 7, markerEnd) : undefined;
  const visiblePrompt = prompt.replaceAll("[e2e:slow]", "").replaceAll("[e2e:error]", "").trim();
  return marker ?? `Stub response: ${visiblePrompt}`;
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
  const backend = headers["x-monte-carlo-storage-backend"];
  const envelopeVersion = Number(headers["x-monte-carlo-envelope-version"]);
  const sha256 = headers["x-monte-carlo-sha256"];
  const manifestId = headers["x-monte-carlo-manifest-id"];
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
        runtimeProvider("ollama", "none", "ready"),
        runtimeProvider("openrouter", "api-key", "needs-configuration"),
        runtimeProvider("anthropic", "local-subscription", "ready"),
      ],
    });
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
    if (!body) {
      await json(route, { error: "not found" }, 404);
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        ...corsHeaders(envelopeContentType),
        "x-monte-carlo-envelope-version": "1",
        "x-monte-carlo-sha256": objectKey.split("/").at(-1) ?? "",
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
  const state: RuntimeMock = { chatRequests: [], blobs: new Map() };
  await context.route(runtimePattern, (route) => handleRuntimeRoute(route, state));
  return state;
}
