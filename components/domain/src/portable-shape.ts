/** Performs dependency-free structural validation for portable workspace envelopes. */

import type { PortableValidationIssue } from "./portable";
import type { JsonValue } from "./types";

type UnknownRecord = Record<string, unknown>;

interface PortableShapeExpectations {
  format: string;
  envelopeVersion: number;
  schemaVersion: number;
}

const MESSAGE_ROLES = new Set(["system", "user", "assistant", "tool"]);
const MESSAGE_STATUSES = new Set(["streaming", "complete", "failed", "cancelled"]);
const RUN_STATUSES = new Set(["queued", "running", "complete", "failed", "cancelled"]);
const RUNTIME_PROVIDERS = new Set(["codex", "anthropic", "openrouter", "ollama"]);
const REASONING_EFFORTS = new Set(["none", "low", "medium", "high"]);
const REASONING_STATES = new Set(["streaming", "complete"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: PortableValidationIssue[],
  path: string,
  code: PortableValidationIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

function requireRecord(
  value: unknown,
  path: string,
  issues: PortableValidationIssue[],
): UnknownRecord | null {
  if (isRecord(value)) return value;
  addIssue(issues, path, "invalid_type", "Expected an object");
  return null;
}

function requireArray(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: PortableValidationIssue[],
): readonly unknown[] {
  const value = record[key];
  if (Array.isArray(value)) return value;
  addIssue(issues, `${path}.${key}`, "invalid_type", "Expected an array");
  return [];
}

function requireString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: PortableValidationIssue[],
): string | null {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) return value;
  addIssue(issues, `${path}.${key}`, "invalid_type", "Expected a non-empty string");
  return null;
}

function optionalString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: PortableValidationIssue[],
): void {
  const value = record[key];
  if (value !== undefined && typeof value !== "string") {
    addIssue(issues, `${path}.${key}`, "invalid_type", "Expected a string when present");
  }
}

function requireNumber(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: PortableValidationIssue[],
  options?: { integer?: boolean; minimum?: number },
): number | null {
  const value = record[key];
  const validNumber = typeof value === "number" && Number.isFinite(value);
  const validInteger = !options?.integer || (validNumber && Number.isInteger(value));
  const validMinimum = options?.minimum === undefined || (validNumber && value >= options.minimum);
  if (validNumber && validInteger && validMinimum) return value;
  addIssue(issues, `${path}.${key}`, "invalid_type", "Expected a valid number");
  return null;
}

function optionalNumber(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: PortableValidationIssue[],
  options?: { integer?: boolean; minimum?: number },
): void {
  if (record[key] === undefined) return;
  requireNumber(record, key, path, issues, options);
}

function requireEnum(
  record: UnknownRecord,
  key: string,
  allowed: ReadonlySet<string>,
  path: string,
  issues: PortableValidationIssue[],
): string | null {
  const value = record[key];
  if (typeof value === "string" && allowed.has(value)) return value;
  addIssue(issues, `${path}.${key}`, "invalid_value", "Received an unsupported value");
  return null;
}

function optionalBoolean(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: PortableValidationIssue[],
): void {
  const value = record[key];
  if (value !== undefined && typeof value !== "boolean") {
    addIssue(issues, `${path}.${key}`, "invalid_type", "Expected a boolean when present");
  }
}

function isJsonValue(value: unknown, seen: WeakSet<object>, depth = 0): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > 50 || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isJsonValue(item, seen, depth + 1)) return false;
    }
    seen.delete(value);
    return true;
  }
  for (const nested of Object.values(value)) {
    if (!isJsonValue(nested, seen, depth + 1)) return false;
  }
  seen.delete(value);
  return true;
}

function requireTimestamps(
  record: UnknownRecord,
  path: string,
  issues: PortableValidationIssue[],
  fields: readonly string[],
): void {
  for (const field of fields) requireNumber(record, field, path, issues, { minimum: 0 });
}

function optionalTimestamps(
  record: UnknownRecord,
  path: string,
  issues: PortableValidationIssue[],
  fields: readonly string[],
): void {
  for (const field of fields) optionalNumber(record, field, path, issues, { minimum: 0 });
}

function validateWorkspace(value: unknown, path: string, issues: PortableValidationIssue[]): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  requireString(record, "id", path, issues);
  requireString(record, "name", path, issues);
  requireTimestamps(record, path, issues, ["createdAt", "updatedAt"]);
}

function validateProject(value: unknown, path: string, issues: PortableValidationIssue[]): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  requireString(record, "id", path, issues);
  requireString(record, "workspaceId", path, issues);
  requireString(record, "name", path, issues);
  optionalString(record, "description", path, issues);
  requireTimestamps(record, path, issues, ["createdAt", "updatedAt"]);
  optionalTimestamps(record, path, issues, ["archivedAt"]);
}

function validateChat(value: unknown, path: string, issues: PortableValidationIssue[]): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  requireString(record, "id", path, issues);
  requireString(record, "workspaceId", path, issues);
  optionalString(record, "projectId", path, issues);
  requireString(record, "rootBranchId", path, issues);
  requireString(record, "title", path, issues);
  requireTimestamps(record, path, issues, ["createdAt", "updatedAt"]);
  optionalTimestamps(record, path, issues, ["archivedAt"]);
}

function validateTextSelection(
  value: unknown,
  path: string,
  issues: PortableValidationIssue[],
): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  requireNumber(record, "partIndex", path, issues, { integer: true, minimum: 0 });
  requireNumber(record, "startOffset", path, issues, { integer: true, minimum: 0 });
  requireNumber(record, "endOffset", path, issues, { integer: true, minimum: 1 });
  requireString(record, "selectedText", path, issues);
}

function validateBranch(value: unknown, path: string, issues: PortableValidationIssue[]): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  requireString(record, "id", path, issues);
  requireString(record, "workspaceId", path, issues);
  requireString(record, "chatId", path, issues);
  optionalString(record, "parentBranchId", path, issues);
  optionalString(record, "title", path, issues);
  requireTimestamps(record, path, issues, ["createdAt"]);

  const origin = requireRecord(record.origin, `${path}.origin`, issues);
  if (!origin) return;
  const type = requireString(origin, "type", `${path}.origin`, issues);
  if (type === "root") return;
  if (type === "prompt") {
    requireString(origin, "anchorMessageId", `${path}.origin`, issues);
    requireString(origin, "prompt", `${path}.origin`, issues);
    return;
  }
  if (type === "selection") {
    requireString(origin, "sourceMessageId", `${path}.origin`, issues);
    optionalString(origin, "prompt", `${path}.origin`, issues);
    validateTextSelection(origin.selection, `${path}.origin.selection`, issues);
    return;
  }
  if (type !== null) {
    addIssue(issues, `${path}.origin.type`, "invalid_value", "Unknown branch origin type");
  }
}

function validateMessagePart(
  value: unknown,
  path: string,
  issues: PortableValidationIssue[],
): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  const type = requireString(record, "type", path, issues);
  switch (type) {
    case "text":
    case "reasoning":
      if (typeof record.text !== "string") {
        addIssue(issues, `${path}.text`, "invalid_type", "Expected text content");
      }
      if (type === "reasoning" && record.state !== undefined) {
        requireEnum(record, "state", REASONING_STATES, path, issues);
      }
      return;
    case "blob":
      requireString(record, "blobId", path, issues);
      requireString(record, "mediaType", path, issues);
      optionalString(record, "name", path, issues);
      return;
    case "tool_call":
      requireString(record, "toolCallId", path, issues);
      requireString(record, "toolName", path, issues);
      if (!isJsonValue(record.input, new WeakSet<object>())) {
        addIssue(issues, `${path}.input`, "invalid_type", "Tool input must be JSON-compatible");
      }
      return;
    case "tool_result":
      requireString(record, "toolCallId", path, issues);
      requireString(record, "toolName", path, issues);
      optionalBoolean(record, "isError", path, issues);
      if (!isJsonValue(record.output, new WeakSet<object>())) {
        addIssue(issues, `${path}.output`, "invalid_type", "Tool output must be JSON-compatible");
      }
      return;
    case "citation":
      requireString(record, "uri", path, issues);
      optionalString(record, "title", path, issues);
      return;
    default:
      if (type !== null) {
        addIssue(issues, `${path}.type`, "invalid_value", "Unknown message part type");
      }
  }
}

function validateMessage(value: unknown, path: string, issues: PortableValidationIssue[]): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  requireString(record, "id", path, issues);
  requireString(record, "workspaceId", path, issues);
  requireString(record, "chatId", path, issues);
  requireString(record, "branchId", path, issues);
  requireNumber(record, "sequence", path, issues, { integer: true, minimum: 0 });
  requireEnum(record, "role", MESSAGE_ROLES, path, issues);
  requireEnum(record, "status", MESSAGE_STATUSES, path, issues);
  optionalString(record, "runId", path, issues);
  requireTimestamps(record, path, issues, ["createdAt", "updatedAt"]);
  const parts = requireArray(record, "parts", path, issues);
  for (let index = 0; index < parts.length; index += 1) {
    validateMessagePart(parts[index], `${path}.parts[${index}]`, issues);
  }
}

function validateTokenUsage(value: unknown, path: string, issues: PortableValidationIssue[]): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  for (const field of [
    "inputTokens",
    "outputTokens",
    "cachedInputTokens",
    "reasoningTokens",
    "totalTokens",
  ]) {
    optionalNumber(record, field, path, issues, { integer: true, minimum: 0 });
  }
}

function validateRun(value: unknown, path: string, issues: PortableValidationIssue[]): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  requireString(record, "id", path, issues);
  requireString(record, "workspaceId", path, issues);
  requireString(record, "chatId", path, issues);
  requireString(record, "branchId", path, issues);
  requireString(record, "requestMessageId", path, issues);
  optionalString(record, "responseMessageId", path, issues);
  requireEnum(record, "status", RUN_STATUSES, path, issues);
  requireTimestamps(record, path, issues, ["createdAt"]);
  optionalTimestamps(record, path, issues, ["startedAt", "finishedAt"]);

  const target = requireRecord(record.target, `${path}.target`, issues);
  if (target) {
    requireEnum(target, "provider", RUNTIME_PROVIDERS, `${path}.target`, issues);
    requireString(target, "modelId", `${path}.target`, issues);
    optionalString(target, "connectionId", `${path}.target`, issues);
  }
  if (record.settings !== undefined) {
    const settings = requireRecord(record.settings, `${path}.settings`, issues);
    if (settings) {
      optionalNumber(settings, "maxOutputTokens", `${path}.settings`, issues, {
        integer: true,
        minimum: 1,
      });
      optionalNumber(settings, "temperature", `${path}.settings`, issues, { minimum: 0 });
      if (settings.reasoningEffort !== undefined) {
        requireEnum(settings, "reasoningEffort", REASONING_EFFORTS, `${path}.settings`, issues);
      }
    }
  }
  if (record.usage !== undefined) validateTokenUsage(record.usage, `${path}.usage`, issues);
  if (record.error !== undefined) {
    const error = requireRecord(record.error, `${path}.error`, issues);
    if (error) {
      requireString(error, "code", `${path}.error`, issues);
      requireString(error, "message", `${path}.error`, issues);
      if (typeof error.retryable !== "boolean") {
        addIssue(issues, `${path}.error.retryable`, "invalid_type", "Expected a boolean");
      }
    }
  }
}

function validateBlob(value: unknown, path: string, issues: PortableValidationIssue[]): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  requireString(record, "id", path, issues);
  requireString(record, "mediaType", path, issues);
  requireNumber(record, "byteLength", path, issues, { integer: true, minimum: 0 });
  optionalString(record, "fileName", path, issues);
  const digest = requireRecord(record.digest, `${path}.digest`, issues);
  if (!digest) return;
  if (digest.algorithm !== "sha256") {
    addIssue(issues, `${path}.digest.algorithm`, "invalid_value", "Only sha256 is supported");
  }
  if (typeof digest.value !== "string" || !SHA256_PATTERN.test(digest.value)) {
    addIssue(issues, `${path}.digest.value`, "invalid_value", "Expected a SHA-256 hex digest");
  }
}

function validateManifest(
  value: unknown,
  path: string,
  expectedSchemaVersion: number,
  issues: PortableValidationIssue[],
): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  if (record.schemaVersion !== expectedSchemaVersion) {
    addIssue(
      issues,
      `${path}.schemaVersion`,
      "unsupported_version",
      `Only schema version ${expectedSchemaVersion} is supported`,
    );
  }
  validateWorkspace(record.workspace, `${path}.workspace`, issues);
  const collections = [
    ["projects", validateProject],
    ["chats", validateChat],
    ["branches", validateBranch],
    ["messages", validateMessage],
    ["runs", validateRun],
    ["blobs", validateBlob],
  ] as const;
  for (const [key, validator] of collections) {
    const entries = requireArray(record, key, path, issues);
    for (let index = 0; index < entries.length; index += 1) {
      validator(entries[index], `${path}.${key}[${index}]`, issues);
    }
  }
}

/** Validates all scalar and collection shapes before typed reference checks run. */
export function validatePortableWorkspaceEnvelopeShape(
  value: unknown,
  expected: PortableShapeExpectations,
  issues: PortableValidationIssue[],
): boolean {
  const issueCount = issues.length;
  const envelope = requireRecord(value, "$", issues);
  if (!envelope) return false;
  if (envelope.format !== expected.format) {
    addIssue(issues, "$.format", "invalid_value", `Expected '${expected.format}'`);
  }
  if (envelope.envelopeVersion !== expected.envelopeVersion) {
    addIssue(
      issues,
      "$.envelopeVersion",
      "unsupported_version",
      `Only envelope version ${expected.envelopeVersion} is supported`,
    );
  }
  requireNumber(envelope, "exportedAt", "$", issues, { minimum: 0 });
  validateManifest(envelope.manifest, "$.manifest", expected.schemaVersion, issues);
  return issues.length === issueCount;
}
