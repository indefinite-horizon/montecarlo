/** Serves authenticated loopback chat, auth, cancellation, and blob APIs. */

import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { RuntimeConfig } from "./config.js";
import { HttpError, toPublicError } from "./errors.js";
import type { RunnerRegistry } from "./registry.js";
import {
  applyAndValidateCors,
  applySecurityHeaders,
  assertAuthorized,
  assertLoopbackHostHeader,
} from "./security.js";
import { decodeObjectKeyPath, parsePortableObjectKey } from "./storage/key.js";
import {
  InvalidObjectKeyError,
  ObjectIntegrityError,
  ObjectNotFoundError,
  type ObjectStoreBackend,
  type ObjectStoreV1,
} from "./storage/types.js";
import { EventStreamWriter } from "./stream.js";
import {
  type ChatRequest,
  hasLocalAuth,
  type ProviderHealth,
  type ProviderId,
  type Runner,
} from "./types.js";
import {
  assertDeviceLoginBody,
  parseChatRequest,
  parseModelCatalogRequest,
  parseStreamFormat,
  readBinaryBody,
  readJsonBody,
} from "./validation.js";

interface ActiveOperation {
  controller: AbortController;
  provider: ProviderId;
}

export interface RuntimeServerOptions {
  config: RuntimeConfig;
  registry: RunnerRegistry;
  objectStore?: ObjectStoreV1;
  objectStores?: Partial<Record<ObjectStoreBackend, ObjectStoreV1>>;
}

export interface RuntimeAddress {
  host: string;
  port: number;
  url: string;
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function writeError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    if (!response.writableEnded) response.end();
    return;
  }
  if (error instanceof HttpError) {
    writeJson(response, error.status, { error: { code: error.code, message: error.message } });
    return;
  }
  writeJson(response, 500, {
    error: { code: "internal_error", message: "The local runtime could not complete the request." },
  });
}

async function safeHealth(runner: Runner, signal?: AbortSignal): Promise<ProviderHealth> {
  try {
    return await runner.health(signal);
  } catch {
    return { status: "unavailable", detail: "The provider health check failed." };
  }
}

function attachDisconnectCancellation(
  request: IncomingMessage,
  response: ServerResponse,
  controller: AbortController,
): () => void {
  const onDisconnect = () => {
    if (!response.writableEnded) controller.abort("client-disconnected");
  };
  request.once("aborted", onDisconnect);
  response.once("close", onDisconnect);
  return () => {
    request.removeListener("aborted", onDisconnect);
    response.removeListener("close", onDisconnect);
  };
}

export class RuntimeServer {
  private readonly config: RuntimeConfig;
  private readonly registry: RunnerRegistry;
  private readonly objectStores: ReadonlyMap<ObjectStoreBackend, ObjectStoreV1>;
  private readonly server: Server;
  private readonly activeOperations = new Map<string, ActiveOperation>();

  constructor(options: RuntimeServerOptions) {
    this.config = options.config;
    this.registry = options.registry;
    if (options.objectStore && options.objectStores) {
      throw new Error("Configure objectStore or objectStores, not both.");
    }
    const stores = new Map<ObjectStoreBackend, ObjectStoreV1>();
    const configuredStores = options.objectStores
      ? (Object.entries(options.objectStores) as Array<
          [ObjectStoreBackend, ObjectStoreV1 | undefined]
        >)
      : [];
    for (const [backend, store] of configuredStores) {
      if (!store || store.backend !== backend) {
        throw new Error("Object store backend configuration is inconsistent.");
      }
      stores.set(backend, store);
    }
    if (options.objectStore) stores.set(options.objectStore.backend, options.objectStore);
    this.objectStores = stores;
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => writeError(response, error));
    });
  }

  listen(): Promise<RuntimeAddress> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(this.config.port, this.config.host, () => {
        this.server.removeListener("error", onError);
        const address = this.server.address() as AddressInfo;
        const displayHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
        resolve({
          host: address.address,
          port: address.port,
          url: `http://${displayHost}:${address.port}`,
        });
      });
    });
  }

  async close(): Promise<void> {
    for (const operation of this.activeOperations.values()) operation.controller.abort("shutdown");
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error === undefined ? resolve() : reject(error)));
      this.server.closeAllConnections();
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    applySecurityHeaders(response);
    assertLoopbackHostHeader(request);
    applyAndValidateCors(request, response, this.config);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    assertAuthorized(request, this.config);

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/v1/health") {
      writeJson(response, 200, {
        status: "ready",
        service: "montecarlo-runtime",
        activeOperations: this.activeOperations.size,
        objectStore:
          this.objectStores.size === 0
            ? { configured: false }
            : {
                configured: true,
                backends: [...this.objectStores.keys()],
                version: 1,
              },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/providers") {
      await this.handleProviders(response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/models") {
      await this.handleModels(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/auth/codex/status") {
      await this.handleAuthStatus(response, "codex");
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/auth/codex/device-login") {
      await this.handleDeviceLogin(request, response, url, "codex");
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/auth/anthropic/status") {
      await this.handleAuthStatus(response, "anthropic");
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/auth/anthropic/device-login") {
      await this.handleDeviceLogin(request, response, url, "anthropic");
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/chat") {
      await this.handleChat(request, response, url);
      return;
    }

    let objectKey: string | undefined;
    try {
      objectKey = decodeObjectKeyPath(url.pathname);
    } catch (error) {
      throw this.mapObjectStoreError(error, "get");
    }
    if (objectKey !== undefined && request.method === "PUT") {
      await this.handleBlobPut(request, response, url, objectKey);
      return;
    }
    if (objectKey !== undefined && request.method === "GET") {
      await this.handleBlobGet(request, response, url, objectKey);
      return;
    }

    const cancelMatch = /^\/v1\/runs\/([0-9a-f-]{36})\/cancel$/.exec(url.pathname);
    if (request.method === "POST" && cancelMatch?.[1] !== undefined) {
      this.handleCancellation(response, cancelMatch[1]);
      return;
    }
    throw new HttpError(404, "not_found", "The requested runtime endpoint does not exist.");
  }

  private async handleProviders(response: ServerResponse): Promise<void> {
    const providers = await Promise.all(
      this.registry.list().map(async (runner) => ({
        ...runner.descriptor,
        health: await safeHealth(runner),
      })),
    );
    writeJson(response, 200, { providers });
  }

  private async handleModels(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = parseModelCatalogRequest(
      await readJsonBody(request, this.config.maxRequestBytes),
    );
    const runner = this.registry.get(input.provider);
    if (!runner.listModels) {
      throw new HttpError(
        501,
        "model_catalog_unavailable",
        "This provider does not expose a model catalog.",
      );
    }
    writeJson(response, 200, await runner.listModels(input.connection));
  }

  private async handleAuthStatus(response: ServerResponse, provider: ProviderId): Promise<void> {
    const runner = this.registry.get(provider);
    if (!hasLocalAuth(runner)) {
      throw new HttpError(501, "auth_unavailable", "The provider auth connector is unavailable.");
    }
    writeJson(response, 200, await runner.authStatus());
  }

  private async handleDeviceLogin(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    provider: ProviderId,
  ): Promise<void> {
    const body = await readJsonBody(request, this.config.maxRequestBytes, { optional: true });
    assertDeviceLoginBody(body);
    const runner = this.registry.get(provider);
    if (!hasLocalAuth(runner)) {
      throw new HttpError(501, "auth_unavailable", "The provider auth connector is unavailable.");
    }

    const format = parseStreamFormat(request, url);
    const runId = randomUUID();
    const controller = new AbortController();
    const detach = attachDisconnectCancellation(request, response, controller);
    this.activeOperations.set(runId, { controller, provider });
    const writer = new EventStreamWriter(response, format);

    try {
      await writer.write({ type: "start", runId, provider, operation: "device-login" });
      for await (const event of runner.deviceLogin(controller.signal)) await writer.write(event);
    } catch (error) {
      if (controller.signal.aborted) {
        await writer.write({ type: "finish", success: false, finishReason: "cancelled" });
      } else {
        await writer.write({
          type: "error",
          code: `${provider}_login_failed`,
          message: toPublicError(error),
          retryable: true,
        });
      }
    } finally {
      detach();
      this.activeOperations.delete(runId);
      writer.end();
    }
  }

  private async handleChat(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const input = parseChatRequest(await readJsonBody(request, this.config.maxRequestBytes));
    const runner = this.registry.get(input.provider);
    if (!runner.descriptor.available) {
      throw new HttpError(
        409,
        "provider_unavailable",
        runner.descriptor.unavailableReason ?? "This provider is unavailable.",
      );
    }

    const format = parseStreamFormat(request, url);
    const runId = randomUUID();
    const controller = new AbortController();
    const detach = attachDisconnectCancellation(request, response, controller);
    this.activeOperations.set(runId, { controller, provider: input.provider });
    const writer = new EventStreamWriter(response, format);
    let finished = false;

    try {
      await writer.write({ type: "start", runId, provider: input.provider, model: input.model });
      for await (const event of runner.run(input, controller.signal)) {
        await writer.write(event);
        if (event.type === "finish") {
          finished = true;
          break;
        }
      }
      if (!finished) {
        await writer.write({
          type: "finish",
          finishReason: controller.signal.aborted ? "cancelled" : "stop",
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        await writer.write({ type: "finish", finishReason: "cancelled" });
      } else {
        await this.writeRunError(writer, error, input);
      }
    } finally {
      detach();
      this.activeOperations.delete(runId);
      writer.end();
    }
  }

  private async writeRunError(
    writer: EventStreamWriter,
    error: unknown,
    input: ChatRequest,
  ): Promise<void> {
    const secrets = input.connection?.apiKey === undefined ? [] : [input.connection.apiKey];
    await writer.write({
      type: "error",
      code: "provider_error",
      message: toPublicError(error, secrets),
      retryable: true,
    });
    await writer.write({ type: "finish", finishReason: "error" });
  }

  private handleCancellation(response: ServerResponse, runId: string): void {
    const operation = this.activeOperations.get(runId);
    if (operation === undefined) {
      throw new HttpError(404, "run_not_found", "The requested run is not active.");
    }
    operation.controller.abort("cancelled-by-client");
    writeJson(response, 202, { runId, status: "cancelling", provider: operation.provider });
  }

  private requireObjectStore(request: IncomingMessage): ObjectStoreV1 {
    const requested = request.headers["x-montecarlo-storage-backend"];
    if (
      Array.isArray(requested) ||
      (requested !== undefined && requested !== "filesystem" && requested !== "r2")
    ) {
      throw new HttpError(
        400,
        "invalid_storage_backend",
        "X-Montecarlo-Storage-Backend must be filesystem or r2.",
      );
    }
    if (requested !== undefined) {
      const store = this.objectStores.get(requested);
      if (store) return store;
      throw new HttpError(
        503,
        "object_store_unavailable",
        `The ${requested} object store is not configured.`,
      );
    }
    if (this.objectStores.size === 1) {
      const store = this.objectStores.values().next().value;
      if (store) return store;
    }
    if (this.objectStores.size > 1) {
      throw new HttpError(
        400,
        "storage_backend_required",
        "X-Montecarlo-Storage-Backend is required when multiple stores are configured.",
      );
    }
    throw new HttpError(503, "object_store_unavailable", "Object storage is not configured.");
  }

  private assertNoBlobQuery(url: URL): void {
    if (url.search !== "") {
      throw new HttpError(400, "invalid_request", "Blob endpoints do not accept query parameters.");
    }
  }

  private assertBlobWorkspaceAllowed(workspaceId: string): void {
    const allowed = this.config.allowedWorkspaceIds;
    if (allowed !== undefined && !allowed.has(workspaceId)) {
      throw new HttpError(403, "workspace_not_allowed", "The object workspace is not allowed.");
    }
  }

  private async handleBlobPut(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    key: string,
  ): Promise<void> {
    this.assertNoBlobQuery(url);
    const objectStore = this.requireObjectStore(request);
    try {
      const parsedKey = parsePortableObjectKey(key);
      this.assertBlobWorkspaceAllowed(parsedKey.workspaceId);
    } catch (error) {
      throw this.mapObjectStoreError(error, "put");
    }
    const mediaType = request.headers["content-type"]?.trim();
    if (mediaType === undefined || mediaType === "" || mediaType.length > 255) {
      throw new HttpError(415, "invalid_media_type", "A valid Content-Type header is required.");
    }
    const envelopeHeader = request.headers["x-montecarlo-envelope-version"];
    const envelopeVersion =
      typeof envelopeHeader === "string" && /^[1-9][0-9]*$/.test(envelopeHeader)
        ? Number(envelopeHeader)
        : Number.NaN;
    if (!Number.isSafeInteger(envelopeVersion)) {
      throw new HttpError(
        400,
        "invalid_envelope_version",
        "X-Montecarlo-Envelope-Version must be a positive integer.",
      );
    }
    const expectedHeader = request.headers["x-montecarlo-sha256"];
    const expectedSha256 =
      typeof expectedHeader === "string" ? expectedHeader.toLowerCase() : undefined;
    if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
      throw new HttpError(
        400,
        "invalid_sha256",
        "X-Montecarlo-SHA256 must be a lowercase or uppercase SHA-256 hex digest.",
      );
    }
    const data = await readBinaryBody(request, this.config.maxBlobBytes);
    try {
      const manifest = await objectStore.put({
        key,
        data,
        mediaType,
        envelopeVersion,
        expectedSha256,
      });
      const manifestId = request.headers["x-montecarlo-manifest-id"];
      const encodedPrivateKey = this.config.blobAttestationPrivateKey;
      if (typeof manifestId !== "string" || !manifestId || !encodedPrivateKey) {
        throw new HttpError(
          503,
          "blob_attestation_unavailable",
          "Blob attestation is not configured.",
        );
      }
      const payload = [
        manifestId,
        manifest.backend,
        manifest.key,
        manifest.sha256,
        manifest.byteLength,
        manifest.envelopeVersion,
        manifest.mediaType,
      ].join("\n");
      let attestation: string;
      try {
        const privateKey = createPrivateKey({
          key: Buffer.from(encodedPrivateKey, "base64"),
          format: "der",
          type: "pkcs8",
        });
        attestation = sign("sha256", Buffer.from(payload), {
          key: privateKey,
          dsaEncoding: "ieee-p1363",
        }).toString("base64url");
      } catch {
        throw new HttpError(
          503,
          "blob_attestation_unavailable",
          "Blob attestation is not configured.",
        );
      }
      writeJson(response, 200, { manifest, attestation });
    } catch (error) {
      throw this.mapObjectStoreError(error, "put");
    }
  }

  private async handleBlobGet(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    key: string,
  ): Promise<void> {
    this.assertNoBlobQuery(url);
    const objectStore = this.requireObjectStore(request);
    try {
      const parsedKey = parsePortableObjectKey(key);
      this.assertBlobWorkspaceAllowed(parsedKey.workspaceId);
      const stored = await objectStore.get(key);
      response.statusCode = 200;
      response.setHeader("Content-Type", stored.manifest.mediaType);
      response.setHeader("Content-Length", stored.manifest.byteLength);
      response.setHeader("ETag", `"${stored.manifest.sha256}"`);
      response.setHeader("X-Montecarlo-Object-Store-Version", stored.manifest.version);
      response.setHeader("X-Montecarlo-Envelope-Version", stored.manifest.envelopeVersion);
      response.setHeader("X-Montecarlo-SHA256", stored.manifest.sha256);
      response.setHeader("X-Montecarlo-Storage-Backend", stored.manifest.backend);
      response.end(stored.data);
    } catch (error) {
      throw this.mapObjectStoreError(error, "get");
    }
  }

  private mapObjectStoreError(error: unknown, operation: "put" | "get"): HttpError {
    if (error instanceof HttpError) return error;
    if (error instanceof InvalidObjectKeyError) {
      return new HttpError(400, "invalid_object_key", error.message);
    }
    if (error instanceof ObjectNotFoundError) {
      return new HttpError(404, "blob_not_found", "The requested blob does not exist.");
    }
    if (error instanceof ObjectIntegrityError) {
      return operation === "put"
        ? new HttpError(422, "blob_integrity_error", error.message)
        : new HttpError(500, "blob_integrity_error", "Stored blob integrity verification failed.");
    }
    return new HttpError(502, "object_store_error", "The object store request failed.");
  }
}
