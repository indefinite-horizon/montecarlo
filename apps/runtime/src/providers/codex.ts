/** Runs Codex through the official CLI app-server and the user's local plan sign-in. */

import { type ChildProcessByStdio, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { AsyncQueue } from "../asyncQueue.js";
import { runtimeDefaults } from "../config.js";
import { sanitizeProcessOutput } from "../errors.js";
import type {
  AuthEvent,
  ChatRequest,
  LocalAuthRunner,
  ProviderHealth,
  ProviderModel,
  ProviderModelCatalog,
  ReasoningEffort,
  RunnerEvent,
  TokenUsage,
} from "../types.js";
import {
  abortError,
  codexChildEnvironment,
  runStatusCommand,
  streamProcess,
  terminateProcess,
} from "./codexProcess.js";
import { latestUserPrompt, transcriptPrompt } from "./codexPrompt.js";

export { transcriptPrompt } from "./codexPrompt.js";

type InteractiveChild = ChildProcessByStdio<Writable, Readable, Readable>;

type JsonObject = Record<string, unknown>;

type CodexAppServerMessage = {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type CodexAppServerProcess = {
  child: InteractiveChild;
  messages: AsyncQueue<CodexAppServerMessage>;
  workingDirectory: string;
  stderr: () => string;
  stop: () => void;
};

type CodexThreadStartParams = {
  model: string;
  serviceTier: "default" | "fast";
  cwd: string;
  approvalPolicy: "never";
  sandbox: "read-only";
  config: {
    include_apply_patch_tool: false;
    mcp_servers: Record<string, { enabled: false }>;
    sandbox_workspace_write: { network_access: false };
    shell_environment_policy: { inherit: "none" };
    tools: { view_image: false; web_search: false };
    web_search: "disabled";
    features: Record<string, boolean> & { fast_mode: boolean };
  };
  ephemeral: false;
};

const CODEX_DISABLED_FEATURES = [
  "apps",
  "browser_use",
  "code_mode_host",
  "computer_use",
  "enable_mcp_apps",
  "hooks",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "plugins",
  "remote_plugin",
  "shell_snapshot",
  "shell_tool",
  "skill_mcp_dependency_install",
  "tool_call_mcp_elicitation",
  "unified_exec",
] as const;

const CODEX_APP_SERVER_ARGUMENTS = [
  "app-server",
  "--stdio",
  "--config",
  "include_apply_patch_tool=false",
  "--config",
  'shell_environment_policy.inherit="none"',
  "--config",
  "tools.view_image=false",
  "--config",
  "tools.web_search=false",
  "--config",
  'web_search="disabled"',
  ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--config", `features.${feature}=false`]),
] as const;

const MAX_MCP_SERVERS = 1_000;
const MCP_PAGE_SIZE = 100;

type CodexCatalogModel = {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
  supported_reasoning_levels?: unknown;
  additional_speed_tiers?: unknown;
};

export { codexChildEnvironment } from "./codexProcess.js";

function codexFeatureConfig(fastMode: boolean): Record<string, boolean> & {
  fast_mode: boolean;
} {
  return Object.fromEntries([
    ...CODEX_DISABLED_FEATURES.map((feature) => [feature, false] as const),
    ["fast_mode", fastMode] as const,
  ]) as Record<string, boolean> & { fast_mode: boolean };
}

export function normalizeCodexModelCatalog(value: unknown): ProviderModel[] {
  if (typeof value !== "object" || value === null) return [];
  const models = (value as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const model = candidate as CodexCatalogModel;
    if (typeof model.slug !== "string" || model.visibility !== "list") return [];
    const reasoningEfforts: ReasoningEffort[] | undefined = Array.isArray(
      model.supported_reasoning_levels,
    )
      ? model.supported_reasoning_levels.flatMap((level) => {
          if (typeof level !== "object" || level === null) return [];
          const effort = (level as { effort?: unknown }).effort;
          return effort === "none" ||
            effort === "minimal" ||
            effort === "low" ||
            effort === "medium" ||
            effort === "high" ||
            effort === "xhigh" ||
            effort === "max"
            ? [effort]
            : [];
        })
      : undefined;
    return [
      {
        id: model.slug,
        displayName: typeof model.display_name === "string" ? model.display_name : model.slug,
        description: typeof model.description === "string" ? model.description : undefined,
        reasoningEfforts,
        supportsFastMode:
          Array.isArray(model.additional_speed_tiers) &&
          model.additional_speed_tiers.includes("fast"),
      },
    ];
  });
}

async function readCodexModelCatalog(
  executable: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<ProviderModel[]> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runtimeDefaults.providerHealthTimeoutMs);
  timeout.unref();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const child = spawn(executable, ["debug", "models"], {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const onAbort = () => terminateProcess(child);
    combinedSignal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > runtimeDefaults.maxRequestBytes) {
        controller.abort();
        return;
      }
      chunks.push(chunk);
    });
    const code = await exit;
    combinedSignal.removeEventListener("abort", onAbort);
    if (combinedSignal.aborted) throw abortError();
    if (code !== 0) throw new Error("Codex could not list models.");
    return normalizeCodexModelCatalog(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    clearTimeout(timeout);
  }
}

export function codexReasoningEffort(
  reasoningEffort?: ReasoningEffort,
): ReasoningEffort | undefined {
  return reasoningEffort;
}

export function codexFastModeConfig(fastMode = false) {
  return {
    service_tier: fastMode ? "fast" : "default",
    features: { fast_mode: fastMode },
  };
}

export function codexThreadStartParams(
  input: ChatRequest,
  workingDirectory: string,
  mcpServerNames: readonly string[] = [],
): CodexThreadStartParams {
  const fastMode = input.options?.fastMode === true;
  return {
    model: input.model,
    serviceTier: fastMode ? "fast" : "default",
    cwd: workingDirectory,
    approvalPolicy: "never",
    sandbox: "read-only",
    config: {
      include_apply_patch_tool: false,
      mcp_servers: Object.fromEntries(
        mcpServerNames.map((name) => [name, { enabled: false }] as const),
      ),
      sandbox_workspace_write: { network_access: false },
      shell_environment_policy: { inherit: "none" },
      tools: { view_image: false, web_search: false },
      web_search: "disabled",
      features: codexFeatureConfig(fastMode),
    },
    ephemeral: false,
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  return isObject(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function rpcErrorMessage(message: CodexAppServerMessage): string | undefined {
  if (!isObject(message.error)) return undefined;
  return stringField(message.error, "message") ?? "The Codex app-server request failed.";
}

function requestMessage(
  child: InteractiveChild,
  id: number,
  method: string,
  params: JsonObject,
): void {
  if (child.stdin.destroyed || child.stdin.writableEnded) {
    throw new Error("The Codex app-server input stream closed unexpectedly.");
  }
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
}

function notifyMessage(child: InteractiveChild, method: string): void {
  if (child.stdin.destroyed || child.stdin.writableEnded) {
    throw new Error("The Codex app-server input stream closed unexpectedly.");
  }
  child.stdin.write(`${JSON.stringify({ method })}\n`);
}

function startCodexAppServer(
  executable: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): CodexAppServerProcess {
  signal.throwIfAborted();
  const workingDirectory = mkdtempSync(join(tmpdir(), "monte-carlo-codex-"));
  let child: InteractiveChild;
  try {
    child = spawn(executable, [...CODEX_APP_SERVER_ARGUMENTS], {
      cwd: workingDirectory,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    rmSync(workingDirectory, { recursive: true, force: true });
    throw error;
  }
  const messages = new AsyncQueue<CodexAppServerMessage>();
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  let stderr = "";
  let stopping = false;
  let killTimer: NodeJS.Timeout | undefined;
  let removedWorkingDirectory = false;

  const removeWorkingDirectory = () => {
    if (removedWorkingDirectory) return;
    try {
      rmSync(workingDirectory, { recursive: true, force: true });
      removedWorkingDirectory = true;
    } catch {
      // Windows can retain a process working directory until the child closes.
    }
  };

  lines.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isObject(parsed)) throw new Error("Expected a JSON object.");
      messages.push(parsed);
    } catch (error) {
      messages.fail(
        new Error("The Codex app-server returned invalid JSON.", {
          cause: error,
        }),
      );
    }
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr = `${stderr}${sanitizeProcessOutput(chunk.toString())}`.slice(-2_000);
  });
  child.once("error", (error) => messages.fail(error));
  child.once("close", (code) => {
    removeWorkingDirectory();
    if (stopping || code === 0) messages.close();
    else messages.fail(new Error(stderr || `Codex app-server exited with code ${code ?? 1}.`));
  });

  const onAbort = () => {
    stopping = true;
    messages.fail(abortError());
    killTimer = terminateProcess(child);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  return {
    child,
    messages,
    workingDirectory,
    stderr: () => stderr,
    stop: () => {
      stopping = true;
      signal.removeEventListener("abort", onAbort);
      lines.close();
      if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
      if (child.exitCode === null) killTimer = terminateProcess(child);
      removeWorkingDirectory();
      if (killTimer !== undefined) {
        const timer = killTimer;
        child.once("close", () => clearTimeout(timer));
      }
    },
  };
}

async function waitForResponse(
  messages: AsyncQueue<CodexAppServerMessage>,
  id: number,
): Promise<JsonObject> {
  for await (const message of messages) {
    if (message.id === id) {
      const error = rpcErrorMessage(message);
      if (error) throw new Error(error);
      if (!isObject(message.result)) {
        throw new Error("The Codex app-server returned an invalid response.");
      }
      return message.result;
    }
    if (message.id !== undefined && typeof message.method === "string") {
      throw new Error(`The Codex app-server requested unsupported input: ${message.method}.`);
    }
  }
  throw new Error("The Codex app-server closed before responding.");
}

async function readMcpInventory(
  appServer: CodexAppServerProcess,
  nextRequestId: () => number,
  threadId?: string,
): Promise<{ capabilityCount: number; names: string[] }> {
  const names = new Set<string>();
  const seenCursors = new Set<string>();
  let capabilityCount = 0;
  let cursor: string | undefined;
  let hasNextPage = true;

  while (hasNextPage) {
    const requestId = nextRequestId();
    requestMessage(appServer.child, requestId, "mcpServerStatus/list", {
      ...(cursor === undefined ? {} : { cursor }),
      ...(threadId === undefined ? {} : { threadId }),
      detail: "toolsAndAuthOnly",
      limit: MCP_PAGE_SIZE,
    });
    const result = await waitForResponse(appServer.messages, requestId);
    if (!Array.isArray(result.data)) {
      throw new Error("The Codex app-server returned an invalid MCP inventory.");
    }
    for (const entry of result.data) {
      if (!isObject(entry) || typeof entry.name !== "string") {
        throw new Error("The Codex app-server returned an invalid MCP inventory entry.");
      }
      names.add(entry.name);
      capabilityCount += isObject(entry.tools) ? Object.keys(entry.tools).length : 0;
      capabilityCount += Array.isArray(entry.resources) ? entry.resources.length : 0;
      capabilityCount += Array.isArray(entry.resourceTemplates)
        ? entry.resourceTemplates.length
        : 0;
    }
    if (names.size > MAX_MCP_SERVERS) {
      throw new Error("The Codex MCP inventory exceeds the supported limit.");
    }

    const nextCursor = result.nextCursor;
    if (nextCursor === null || nextCursor === undefined) {
      hasNextPage = false;
      continue;
    }
    if (typeof nextCursor !== "string" || seenCursors.has(nextCursor)) {
      throw new Error("The Codex app-server returned an invalid MCP cursor.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { capabilityCount, names: [...names] };
}

function notificationParams(
  message: CodexAppServerMessage,
  method: string,
): JsonObject | undefined {
  return message.method === method && isObject(message.params) ? message.params : undefined;
}

function codexUsage(params: JsonObject): TokenUsage | undefined {
  const tokenUsage = isObject(params.tokenUsage) ? params.tokenUsage : undefined;
  const last = tokenUsage && isObject(tokenUsage.last) ? tokenUsage.last : undefined;
  if (!last) return undefined;
  return {
    inputTokens: typeof last.inputTokens === "number" ? last.inputTokens : undefined,
    outputTokens: typeof last.outputTokens === "number" ? last.outputTokens : undefined,
    totalTokens: typeof last.totalTokens === "number" ? last.totalTokens : undefined,
    cachedInputTokens:
      typeof last.cachedInputTokens === "number" ? last.cachedInputTokens : undefined,
    reasoningTokens:
      typeof last.reasoningOutputTokens === "number" ? last.reasoningOutputTokens : undefined,
  };
}

function completedAgentText(
  params: JsonObject,
  streamedTextByItem: Map<string, string>,
): string | undefined {
  if (!isObject(params.item) || params.item.type !== "agentMessage") return undefined;
  const itemId = stringField(params.item, "id");
  const text = stringField(params.item, "text");
  if (!itemId || text === undefined) return undefined;
  const streamed = streamedTextByItem.get(itemId) ?? "";
  if (!text.startsWith(streamed)) return streamed === "" ? text : undefined;
  const suffix = text.slice(streamed.length);
  if (suffix) streamedTextByItem.set(itemId, text);
  return suffix || undefined;
}

export class CodexRunner implements LocalAuthRunner {
  readonly descriptor = {
    id: "codex",
    name: "Codex",
    auth: "local-subscription",
    available: true,
    description: "Codex through the official local CLI using this device's sign-in.",
  } as const;

  private readonly cliExecutable: string;
  private readonly childEnvironment: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.cliExecutable = env.CODEX_PATH?.trim() || "codex";
    this.childEnvironment = codexChildEnvironment(env);
    // The packaged Electron runtime intentionally bundles JavaScript only.
    // App-server stays inside the official CLI credential boundary while exposing the
    // token-level notifications that `codex exec`'s high-level item feed omits.
  }

  health(signal?: AbortSignal): Promise<ProviderHealth> {
    return this.authStatus(signal);
  }

  async authStatus(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const result = await runStatusCommand(this.cliExecutable, this.childEnvironment, signal);
      return result.code === 0
        ? { status: "ready", authenticated: true, detail: "Codex is signed in on this device." }
        : {
            status: "needs-configuration",
            authenticated: false,
            detail: "Codex is installed but is not signed in on this device.",
          };
    } catch (error) {
      if (signal?.aborted === true) throw error;
      return {
        status: "unavailable",
        authenticated: false,
        detail: "The Codex CLI is unavailable on this device.",
      };
    }
  }

  async *deviceLogin(signal: AbortSignal): AsyncIterable<AuthEvent> {
    yield { type: "status", status: "starting", message: "Starting the official Codex CLI." };
    const process = streamProcess(
      this.cliExecutable,
      ["login", "--device-auth"],
      this.childEnvironment,
      signal,
    );
    try {
      yield { type: "status", status: "waiting", message: "Complete sign-in in your browser." };
      for await (const event of process.events) {
        if (event.type === "output") {
          yield { type: "output", delta: event.value, stream: event.stream };
        } else if (event.type === "failure") {
          throw event.error;
        } else if (event.code === 0) {
          yield { type: "finish", success: true };
        } else {
          throw new Error("Codex device login ended before sign-in completed.");
        }
      }
    } finally {
      process.cleanup();
      if (signal.aborted && process.child.exitCode === null) terminateProcess(process.child);
    }
  }

  async listModels(
    _connection?: { baseURL?: string },
    signal?: AbortSignal,
  ): Promise<ProviderModelCatalog> {
    return {
      provider: "codex",
      models: await readCodexModelCatalog(this.cliExecutable, this.childEnvironment, signal),
      source: "cli",
      fetchedAt: Date.now(),
    };
  }

  async *run(input: ChatRequest, signal: AbortSignal): AsyncIterable<RunnerEvent> {
    const appServer = startCodexAppServer(this.cliExecutable, this.childEnvironment, signal);
    try {
      let nextRequestIdValue = 1;
      const nextRequestId = () => nextRequestIdValue++;
      const initializeRequestId = nextRequestId();
      requestMessage(appServer.child, initializeRequestId, "initialize", {
        clientInfo: { name: "monte-carlo", title: "Monte Carlo", version: "0.1.0" },
        capabilities: { experimentalApi: false, requestAttestation: false },
      });
      await waitForResponse(appServer.messages, initializeRequestId);
      notifyMessage(appServer.child, "initialized");

      const globalMcpInventory = await readMcpInventory(appServer, nextRequestId);
      const startParams = codexThreadStartParams(
        input,
        appServer.workingDirectory,
        globalMcpInventory.names,
      );
      const threadRequestId = nextRequestId();
      const threadResult = input.providerThreadId
        ? await (async () => {
            const { ephemeral: _ephemeral, ...resumeParams } = startParams;
            requestMessage(appServer.child, threadRequestId, "thread/resume", {
              threadId: input.providerThreadId,
              ...resumeParams,
            });
            return waitForResponse(appServer.messages, threadRequestId);
          })()
        : await (async () => {
            requestMessage(appServer.child, threadRequestId, "thread/start", startParams);
            return waitForResponse(appServer.messages, threadRequestId);
          })();
      const threadId = stringField(threadResult.thread, "id");
      if (!threadId) throw new Error("The Codex app-server did not return a thread id.");

      const scopedMcpInventory = await readMcpInventory(appServer, nextRequestId, threadId);
      if (scopedMcpInventory.capabilityCount !== 0) {
        throw new Error("The Codex app-server did not disable external tools for this thread.");
      }
      yield { type: "provider-thread", threadId };

      const prompt = input.providerThreadId
        ? latestUserPrompt(input.messages)
        : transcriptPrompt(input.messages);
      const turnRequestId = nextRequestId();
      requestMessage(appServer.child, turnRequestId, "turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        effort: codexReasoningEffort(input.options?.reasoningEffort),
      });

      const streamedTextByItem = new Map<string, string>();
      let usage: TokenUsage | undefined;
      for await (const message of appServer.messages) {
        if (message.id === turnRequestId) {
          const error = rpcErrorMessage(message);
          if (error) throw new Error(error);
          if (!isObject(message.result)) {
            throw new Error("The Codex app-server did not start the turn.");
          }
          continue;
        }
        if (message.id !== undefined && typeof message.method === "string") {
          throw new Error(`The Codex app-server requested unsupported input: ${message.method}.`);
        }

        const textDelta = notificationParams(message, "item/agentMessage/delta");
        if (textDelta) {
          const delta = stringField(textDelta, "delta");
          const itemId = stringField(textDelta, "itemId");
          if (delta && itemId) {
            streamedTextByItem.set(itemId, `${streamedTextByItem.get(itemId) ?? ""}${delta}`);
            yield { type: "text-delta", delta };
          }
          continue;
        }

        const reasoningDelta =
          notificationParams(message, "item/reasoning/summaryTextDelta") ??
          notificationParams(message, "item/reasoning/textDelta");
        if (reasoningDelta) {
          const delta = stringField(reasoningDelta, "delta");
          if (delta) yield { type: "reasoning-delta", delta };
          continue;
        }

        const itemCompleted = notificationParams(message, "item/completed");
        if (itemCompleted) {
          const suffix = completedAgentText(itemCompleted, streamedTextByItem);
          if (suffix) yield { type: "text-delta", delta: suffix };
          continue;
        }

        const usageUpdate = notificationParams(message, "thread/tokenUsage/updated");
        if (usageUpdate) {
          usage = codexUsage(usageUpdate) ?? usage;
          continue;
        }

        const errorNotification = notificationParams(message, "error");
        if (errorNotification && errorNotification.willRetry !== true) {
          const error = isObject(errorNotification.error)
            ? stringField(errorNotification.error, "message")
            : undefined;
          throw new Error(error ?? "The Codex turn failed.");
        }

        const completed = notificationParams(message, "turn/completed");
        if (!completed || !isObject(completed.turn)) continue;
        const status = stringField(completed.turn, "status");
        if (status === "failed") {
          const turnError = isObject(completed.turn.error) ? completed.turn.error : undefined;
          throw new Error(stringField(turnError, "message") ?? "The Codex turn failed.");
        }
        yield {
          type: "finish",
          finishReason: status === "interrupted" ? "cancelled" : "stop",
          usage,
        };
        return;
      }
      throw new Error(appServer.stderr() || "The Codex app-server ended before the turn finished.");
    } finally {
      appServer.stop();
    }
  }
}
