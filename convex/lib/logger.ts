/**
 * OTEL-aligned structured logging primitives for Convex boundaries and service calls.
 *
 * Canonical summary events are emitted automatically by wrappers and client
 * instrumentation. Manual logging is intentionally limited to `debug(...)`
 * so ad hoc logs do not replace the canonical one-event-per-boundary pattern.
 */

// Stamped on every log record so Axiom events can be pinned to a specific deploy.
// Read directly from process.env (not cleanEnv) so importing the logger does not
// trigger env validation — tests and other callers that don't need full env
// validation must still be able to import logger primitives.
const GIT_SHA = process.env.GIT_SHA || undefined;

type LogSeverityText = "DEBUG" | "INFO" | "ERROR";

export interface LogAttributes {
  workspaceId?: string;
  conversationId?: string;
  agentId?: string;
  runId?: string;
  messageId?: string;
  userId?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  request_id?: string | number | null;
  [key: string]: unknown;
}

type CanonicalEventKind = "boundary" | "service_call" | "terminal_error" | "debug";

type SerializedError = {
  type: string;
  message: string;
  stack?: string;
  statusCode?: number;
};

type ServiceCallOptions<T> = {
  targetService: string;
  operation: string;
  attributes?: LogAttributes;
  getSuccessAttributes?: (result: T) => LogAttributes | undefined;
};

type BoundaryLoggerOptions = {
  serviceName: string;
  operation: string;
  boundaryKind: "http" | "function";
  attributes?: LogAttributes;
};

export interface RequestLogger {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  setAttributes(attributes: LogAttributes): void;
  debug(message: string, attributes?: LogAttributes): void;
  withServiceCall<T>(options: ServiceCallOptions<T>, fn: () => Promise<T>): Promise<T>;
}

export interface BoundaryLogger extends RequestLogger {
  complete(attributes?: LogAttributes): void;
  completeWithError(error: unknown, attributes?: LogAttributes): void;
}

type ServiceCallOutcome = "success" | "error";

const REDACTED_LOG_VALUE = "[REDACTED]";
const CIRCULAR_LOG_VALUE = "[Circular]";
const MAX_LOG_ATTRIBUTE_DEPTH = 8;

const SAFE_TOKEN_METRIC_KEYS = new Set([
  "cachedinputtokens",
  "inputtokens",
  "outputtokens",
  "reasoningtokens",
  "tokencount",
  "tokens",
  "tokenusage",
  "totaltokens",
]);

const SENSITIVE_EXACT_ATTRIBUTE_KEYS = new Set([
  "apikey",
  "appcredentialssecret",
  "authorization",
  "body",
  "clientsecret",
  "content",
  "cookie",
  "credentials",
  "env",
  "envvars",
  "headers",
  "password",
  "payload",
  "plaintext",
  "privatekey",
  "prompt",
  "rawerror",
  "requestbody",
  "responsebody",
  "result",
  "secret",
  "sessioncookie",
  "systemprompt",
]);

function normalizeAttributeKey(key: string) {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isSensitiveAttributeKey(key: string) {
  const normalized = normalizeAttributeKey(key);
  if (SAFE_TOKEN_METRIC_KEYS.has(normalized)) {
    return false;
  }
  if (SENSITIVE_EXACT_ATTRIBUTE_KEYS.has(normalized)) {
    return true;
  }
  return (
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("apikey") ||
    normalized.includes("credential")
  );
}

function redactSensitiveText(text: string) {
  return text
    .replace(/(https?:\/\/)[^@/\s]+@/g, `$1${REDACTED_LOG_VALUE}@`)
    .replace(/\bgh[pous]_[a-zA-Z0-9]{36}\b/g, (token) => `${token.slice(0, 4)}***REDACTED***`)
    .replace(/\bgithub_pat_[a-zA-Z0-9_]{82}\b/g, "github_pat_***REDACTED***")
    .replace(/\bglpat-[a-zA-Z0-9_-]{20,}\b/g, "glpat-***REDACTED***")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED_LOG_VALUE}`)
    .replace(
      /\b(access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|secret)=([^&\s]+)/gi,
      `$1=${REDACTED_LOG_VALUE}`,
    );
}

function sanitizeLogValue(
  key: string | undefined,
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (key && isSensitiveAttributeKey(key)) {
    return REDACTED_LOG_VALUE;
  }
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return CIRCULAR_LOG_VALUE;
  }
  if (depth >= MAX_LOG_ATTRIBUTE_DEPTH) {
    return "[MaxDepth]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizeLogValue(undefined, item, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  if (value instanceof Date) {
    seen.delete(value);
    return value.toISOString();
  }
  if (value instanceof Error) {
    const result = sanitizeSerializedError(serializeError(value));
    seen.delete(value);
    return result;
  }
  const result = Object.fromEntries(
    Object.entries(value)
      .map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeLogValue(nestedKey, nestedValue, seen, depth + 1),
      ])
      .filter(([, nestedValue]) => nestedValue !== undefined),
  );
  seen.delete(value);
  return result;
}

function sanitizeLogAttributes(attributes?: LogAttributes) {
  if (!attributes) {
    return {};
  }
  return sanitizeLogValue(undefined, attributes, new WeakSet<object>(), 0) as LogAttributes;
}

function omitUndefined(attributes?: LogAttributes) {
  if (!attributes) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined),
  ) as LogAttributes;
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    // Extract statusCode from AI SDK errors (AI_APICallError) and similar HTTP errors
    const statusCode =
      "statusCode" in error && typeof (error as Record<string, unknown>).statusCode === "number"
        ? ((error as Record<string, unknown>).statusCode as number)
        : undefined;
    return {
      type: error.name || "Error",
      message: error.message,
      stack: error.stack,
      statusCode,
    };
  }
  return {
    type: typeof error === "string" ? "Error" : "UnknownError",
    message: typeof error === "string" ? error : String(error),
  };
}

function sanitizeSerializedError(error: SerializedError): SerializedError {
  return {
    ...error,
    message: redactSensitiveText(error.message),
    ...(error.stack ? { stack: redactSensitiveText(error.stack) } : {}),
  };
}

function createTraceId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function createSpanId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function writeLogRecord(
  severityText: LogSeverityText,
  body: string,
  eventKind: CanonicalEventKind,
  attributes: LogAttributes,
  error?: unknown,
) {
  const sanitizedAttributes = sanitizeLogAttributes(attributes);
  const serializedError =
    error === undefined ? undefined : sanitizeSerializedError(serializeError(error));
  const entry = {
    ...sanitizedAttributes,
    timestamp: new Date().toISOString(),
    severity_text: severityText,
    body,
    "event.kind": eventKind,
    ...(GIT_SHA ? { "git.sha": GIT_SHA } : {}),
    ...(serializedError
      ? {
          "error.type": serializedError.type,
          "error.message": serializedError.message,
          ...(serializedError.statusCode !== undefined
            ? { "http.response.status_code": serializedError.statusCode }
            : {}),
          error: serializedError,
        }
      : {}),
  };

  const line = JSON.stringify(entry);
  if (severityText === "DEBUG") {
    console.debug(line);
    return;
  }
  if (severityText === "ERROR") {
    console.error(line);
    return;
  }
  console.info(line);
}

function emitCanonicalEvent(
  severityText: LogSeverityText,
  body: string,
  attributes: LogAttributes,
  error?: unknown,
) {
  writeLogRecord(severityText, body, "boundary", attributes, error);
}

function emitServiceCallEvent(
  severityText: LogSeverityText,
  body: string,
  attributes: LogAttributes,
  error?: unknown,
) {
  writeLogRecord(severityText, body, "service_call", attributes, error);
}

function emitTerminalError(body: string, attributes: LogAttributes, error: unknown) {
  writeLogRecord("ERROR", body, "terminal_error", attributes, error);
}

class RequestBoundaryLogger implements BoundaryLogger {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;

  private readonly baseAttributes: LogAttributes;
  private readonly startedAt: number;
  private dynamicAttributes: LogAttributes = {};

  constructor(options: BoundaryLoggerOptions) {
    this.traceId = createTraceId();
    this.spanId = createSpanId();
    this.baseAttributes = omitUndefined({
      "service.name": options.serviceName,
      operation: options.operation,
      "boundary.kind": options.boundaryKind,
      trace_id: this.traceId,
      span_id: this.spanId,
      ...options.attributes,
    });
    this.startedAt = Date.now();
  }

  setAttributes(attributes: LogAttributes) {
    this.dynamicAttributes = {
      ...this.dynamicAttributes,
      ...omitUndefined(attributes),
    };
  }

  debug(message: string, attributes?: LogAttributes) {
    writeLogRecord("DEBUG", message, "debug", this.mergeAttributes(attributes));
  }

  complete(attributes?: LogAttributes) {
    emitCanonicalEvent(
      "INFO",
      "boundary completed",
      this.mergeAttributes(attributes, {
        duration_ms: Date.now() - this.startedAt,
        outcome: "success",
      }),
    );
  }

  completeWithError(error: unknown, attributes?: LogAttributes) {
    const mergedAttributes = this.mergeAttributes(attributes, {
      duration_ms: Date.now() - this.startedAt,
      outcome: "error",
    });
    emitTerminalError("uncaught boundary error", mergedAttributes, error);
    emitCanonicalEvent("INFO", "boundary completed", mergedAttributes);
  }

  async withServiceCall<T>(options: ServiceCallOptions<T>, fn: () => Promise<T>) {
    const childSpanId = createSpanId();
    const startedAt = Date.now();
    const serviceAttributes = omitUndefined({
      ...this.currentAttributes(),
      span_id: childSpanId,
      parent_span_id: this.spanId,
      "peer.service": options.targetService,
      operation: options.operation,
      ...options.attributes,
    });

    try {
      const result = await fn();
      const successAttributes = omitUndefined(options.getSuccessAttributes?.(result));
      const serviceOutcome =
        (successAttributes.outcome as ServiceCallOutcome | undefined) ?? "success";
      emitServiceCallEvent(
        serviceOutcome === "error" ? "ERROR" : "INFO",
        serviceOutcome === "error" ? "service call failed" : "service call completed",
        omitUndefined({
          ...serviceAttributes,
          duration_ms: Date.now() - startedAt,
          outcome: serviceOutcome,
          ...successAttributes,
        }),
      );
      return result;
    } catch (error) {
      emitServiceCallEvent(
        "ERROR",
        "service call failed",
        omitUndefined({
          ...serviceAttributes,
          duration_ms: Date.now() - startedAt,
          outcome: "error",
        }),
        error,
      );
      throw error;
    }
  }

  private currentAttributes() {
    return {
      ...this.baseAttributes,
      ...this.dynamicAttributes,
    };
  }

  private mergeAttributes(attributes?: LogAttributes, extraAttributes?: LogAttributes) {
    return omitUndefined({
      ...this.currentAttributes(),
      ...extraAttributes,
      ...attributes,
    });
  }
}

export function createBoundaryLogger(options: BoundaryLoggerOptions): BoundaryLogger {
  return new RequestBoundaryLogger(options);
}

export async function runServiceCallWithLogging<T>(
  options: {
    log?: RequestLogger;
    serviceName: string;
    targetService: string;
    operation: string;
    attributes?: LogAttributes;
    getSuccessAttributes?: (result: T) => LogAttributes | undefined;
  },
  fn: () => Promise<T>,
): Promise<T> {
  if (options.log) {
    return options.log.withServiceCall(
      {
        targetService: options.targetService,
        operation: options.operation,
        attributes: options.attributes,
        getSuccessAttributes: options.getSuccessAttributes,
      },
      fn,
    );
  }

  const startedAt = Date.now();
  const standaloneAttributes = omitUndefined({
    "service.name": options.serviceName,
    "peer.service": options.targetService,
    operation: options.operation,
    trace_id: createTraceId(),
    span_id: createSpanId(),
    ...options.attributes,
  });

  try {
    const result = await fn();
    const successAttributes = omitUndefined(options.getSuccessAttributes?.(result));
    const serviceOutcome =
      (successAttributes.outcome as ServiceCallOutcome | undefined) ?? "success";
    emitServiceCallEvent(
      serviceOutcome === "error" ? "ERROR" : "INFO",
      serviceOutcome === "error" ? "service call failed" : "service call completed",
      omitUndefined({
        ...standaloneAttributes,
        duration_ms: Date.now() - startedAt,
        outcome: serviceOutcome,
        ...successAttributes,
      }),
    );
    return result;
  } catch (error) {
    emitServiceCallEvent(
      "ERROR",
      "service call failed",
      omitUndefined({
        ...standaloneAttributes,
        duration_ms: Date.now() - startedAt,
        outcome: "error",
      }),
      error,
    );
    throw error;
  }
}

export const logger = {
  debug(message: string, attributes?: LogAttributes) {
    writeLogRecord("DEBUG", message, "debug", omitUndefined(attributes));
  },
};
