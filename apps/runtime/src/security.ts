/** Enforces loopback Host, exact Origin, bearer, and response-header policy. */

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeConfig } from "./config.js";
import { HttpError } from "./errors.js";

const allowedRequestHeaders =
  "authorization, content-type, accept, x-montecarlo-envelope-version, x-montecarlo-sha256, x-montecarlo-storage-backend, x-montecarlo-manifest-id";
const allowedMethods = "GET, POST, PUT, OPTIONS";

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

export function assertLoopbackHostHeader(request: IncomingMessage): void {
  const host = request.headers.host;
  if (host === undefined) throw new HttpError(400, "invalid_host", "A Host header is required.");

  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    throw new HttpError(400, "invalid_host", "The Host header is invalid.");
  }

  const localPort = request.socket.localPort;
  const requestedPort = parsed.port === "" ? undefined : Number(parsed.port);
  if (
    !isLoopbackHostname(parsed.hostname) ||
    (requestedPort !== undefined && localPort !== undefined && requestedPort !== localPort)
  ) {
    throw new HttpError(403, "host_not_allowed", "The Host header is not allowed.");
  }
}

export function applyAndValidateCors(
  request: IncomingMessage,
  response: ServerResponse,
  config: RuntimeConfig,
): void {
  const origin = request.headers.origin;
  response.setHeader("Vary", "Origin");
  if (origin === undefined) return;
  if (origin === "null" || !config.allowedOrigins.has(origin)) {
    throw new HttpError(403, "origin_not_allowed", "The request origin is not allowed.");
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", allowedMethods);
  response.setHeader("Access-Control-Allow-Headers", allowedRequestHeaders);
  response.setHeader("Access-Control-Max-Age", "600");
}

function secureEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function assertAuthorized(request: IncomingMessage, config: RuntimeConfig): void {
  const authenticationRequired = !config.development || config.bearerToken !== undefined;
  if (!authenticationRequired) return;

  const authorization = request.headers.authorization;
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  if (
    supplied === undefined ||
    supplied === "" ||
    supplied.trim() !== supplied ||
    config.bearerToken === undefined ||
    !secureEqual(supplied, config.bearerToken)
  ) {
    throw new HttpError(401, "unauthorized", "A valid bearer token is required.");
  }
}

export function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Cross-Origin-Resource-Policy", "same-site");
  response.setHeader("X-Content-Type-Options", "nosniff");
}
