/** Validates chat requests, stream formats, and provider endpoints. */

import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { runtimeDefaults } from "./config.js";
import { HttpError } from "./errors.js";
import { type ChatRequest, providerIds } from "./types.js";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(200_000),
});

const chatRequestSchema = z
  .object({
    provider: z.enum(providerIds),
    model: z.string().trim().min(1).max(256),
    messages: z.array(messageSchema).min(1).max(200),
    providerThreadId: z.string().trim().min(1).max(256).optional(),
    connection: z
      .object({
        apiKey: z.string().trim().min(1).max(4_096).optional(),
        baseURL: z.string().trim().min(1).max(2_048).optional(),
      })
      .strict()
      .optional(),
    options: z
      .object({
        maxOutputTokens: z.number().int().min(1).max(65_536).optional(),
        temperature: z.number().min(0).max(2).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const totalCharacters = input.messages.reduce(
      (sum, message) => sum + message.content.length,
      0,
    );
    if (totalCharacters > 1_000_000) {
      context.addIssue({ code: "custom", message: "Message content exceeds the request limit." });
    }
    if (input.messages.at(-1)?.role !== "user") {
      context.addIssue({ code: "custom", message: "The final message must have the user role." });
    }
    if (
      (input.provider === "codex" ||
        input.provider === "ollama" ||
        input.provider === "claude-subscription") &&
      input.connection?.apiKey !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: `${input.provider} does not accept an API key.`,
      });
    }
    if (
      (input.provider === "codex" ||
        input.provider === "anthropic" ||
        input.provider === "claude-subscription") &&
      input.connection?.baseURL !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: `${input.provider} does not accept a base URL.`,
      });
    }
    if (input.provider !== "codex" && input.providerThreadId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Provider thread IDs are only supported by the Codex runner.",
      });
    }
  });

export function parseChatRequest(value: unknown): ChatRequest {
  const result = chatRequestSchema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      "invalid_request",
      result.error.issues[0]?.message ?? "Invalid request.",
    );
  }
  return result.data;
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
  options: { optional?: boolean } = {},
): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > maxBytes) {
      throw new HttpError(413, "request_too_large", "The request body is too large.");
    }
    chunks.push(buffer);
  }

  if (byteLength === 0 && options.optional === true) return {};
  if (contentType !== "application/json") {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "The request body must contain valid JSON.");
  }
}

export async function readBinaryBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Uint8Array> {
  const encoding = request.headers["content-encoding"]?.trim().toLowerCase();
  if (encoding !== undefined && encoding !== "identity") {
    throw new HttpError(415, "unsupported_encoding", "Compressed blob uploads are not supported.");
  }
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new HttpError(400, "invalid_content_length", "Content-Length is invalid.");
    }
    if (parsedLength > maxBytes) {
      throw new HttpError(413, "request_too_large", "The blob exceeds the upload limit.");
    }
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > maxBytes) {
      throw new HttpError(413, "request_too_large", "The blob exceeds the upload limit.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseEndpoint(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid_endpoint", `${label} is not a valid URL.`);
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new HttpError(
      400,
      "invalid_endpoint",
      `${label} may not contain credentials, a query, or a fragment.`,
    );
  }
  return url;
}

export function resolveOpenRouterBaseURL(raw?: string): string {
  const url = parseEndpoint(raw ?? runtimeDefaults.openRouterBaseURL, "OpenRouter base URL");
  if (url.protocol !== "https:") {
    throw new HttpError(400, "invalid_endpoint", "OpenRouter endpoints must use HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

export function resolveOllamaBaseURL(raw?: string): string {
  const url = parseEndpoint(raw ?? runtimeDefaults.ollamaBaseURL, "Ollama base URL");
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!loopback || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new HttpError(
      400,
      "invalid_endpoint",
      "Ollama endpoints must use HTTP(S) on localhost, 127.0.0.1, or ::1.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function parseStreamFormat(request: IncomingMessage, url: URL): "sse" | "jsonl" {
  const requested = url.searchParams.get("format");
  if (requested !== null && requested !== "sse" && requested !== "jsonl") {
    throw new HttpError(400, "invalid_format", "format must be sse or jsonl.");
  }
  if (requested !== null) return requested;
  return request.headers.accept?.includes("application/x-ndjson") === true ? "jsonl" : "sse";
}

export function assertDeviceLoginBody(value: unknown): void {
  const result = z
    .object({ method: z.literal("device").optional() })
    .strict()
    .safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      "invalid_request",
      "Only the official device login method is supported.",
    );
  }
}
