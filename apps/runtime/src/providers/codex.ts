/** Runs Codex through the user's official CLI, SDK, and local plan sign-in. */

import { type ChildProcess, type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import {
  Codex,
  type CodexOptions,
  type ModelReasoningEffort,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type Usage,
} from "@openai/codex-sdk";
import { AsyncQueue } from "../asyncQueue.js";
import { runtimeDefaults } from "../config.js";
import { sanitizeProcessOutput } from "../errors.js";
import type {
  AuthEvent,
  ChatMessage,
  ChatRequest,
  LocalAuthRunner,
  ProviderHealth,
  ProviderModel,
  ProviderModelCatalog,
  ReasoningEffort,
  RunnerEvent,
  TokenUsage,
} from "../types.js";

type ProcessEvent =
  | { type: "output"; value: string; stream: "stdout" | "stderr" }
  | { type: "close"; code: number | null }
  | { type: "failure"; error: Error };

type CapturedChild = ChildProcessByStdio<null, Readable, Readable>;

type CodexCatalogModel = {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
  supported_reasoning_levels?: unknown;
  additional_speed_tiers?: unknown;
};

function abortError(): Error {
  const error = new Error("The operation was cancelled.");
  error.name = "AbortError";
  return error;
}

function terminateProcess(child: ChildProcess): NodeJS.Timeout | undefined {
  if (child.exitCode !== null || child.killed) return undefined;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, runtimeDefaults.processKillGraceMs);
  timer.unref();
  return timer;
}

async function runStatusCommand(
  executable: string,
  signal?: AbortSignal,
): Promise<{ code: number | null }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["login", "status"], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let killTimer: NodeJS.Timeout | undefined;
    let aborted = false;
    const timeout = setTimeout(() => {
      killTimer = terminateProcess(child);
    }, runtimeDefaults.providerHealthTimeoutMs);
    timeout.unref();

    const onAbort = () => {
      aborted = true;
      killTimer = terminateProcess(child);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (killTimer !== undefined) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      if (aborted) reject(abortError());
      else resolve({ code });
    });
  });
}

function streamProcess(
  executable: string,
  arguments_: readonly string[],
  signal: AbortSignal,
): { child: CapturedChild; events: AsyncQueue<ProcessEvent>; cleanup: () => void } {
  signal.throwIfAborted();
  const child = spawn(executable, [...arguments_], {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const events = new AsyncQueue<ProcessEvent>();
  let killTimer: NodeJS.Timeout | undefined;
  let aborted = false;

  const onOutput = (stream: "stdout" | "stderr") => (chunk: Buffer | string) => {
    const value = sanitizeProcessOutput(chunk.toString());
    if (value !== "") events.push({ type: "output", value, stream });
  };
  const onAbort = () => {
    aborted = true;
    killTimer = terminateProcess(child);
  };

  child.stdout.on("data", onOutput("stdout"));
  child.stderr.on("data", onOutput("stderr"));
  child.once("error", (error) => events.push({ type: "failure", error }));
  child.once("close", (code) => {
    events.push(aborted ? { type: "failure", error: abortError() } : { type: "close", code });
    events.close();
  });
  signal.addEventListener("abort", onAbort, { once: true });

  return {
    child,
    events,
    cleanup: () => {
      signal.removeEventListener("abort", onAbort);
      if (killTimer !== undefined) clearTimeout(killTimer);
    },
  };
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
  signal?: AbortSignal,
): Promise<ProviderModel[]> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runtimeDefaults.providerHealthTimeoutMs);
  timeout.unref();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const child = spawn(executable, ["debug", "models"], {
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

function escapeRoleContent(content: string): string {
  return content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function transcriptPrompt(messages: ChatMessage[]): string {
  return [
    "Continue this conversation. Reply to the final user message.",
    ...messages.map(
      (message) => `<${message.role}>\n${escapeRoleContent(message.content)}\n</${message.role}>`,
    ),
  ].join("\n\n");
}

function latestUserPrompt(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.content;
  }
  throw new Error("A user message is required.");
}

export function codexReasoningEffort(
  reasoningEffort?: ReasoningEffort,
): ModelReasoningEffort | "none" | "max" | undefined {
  return reasoningEffort;
}

export function codexFastModeConfig(fastMode = false): NonNullable<CodexOptions["config"]> {
  return {
    service_tier: fastMode ? "fast" : "default",
    features: { fast_mode: fastMode },
  };
}

export function codexThreadOptions(input: ChatRequest): ThreadOptions {
  return {
    model: input.model,
    // The CLI model catalog and config accept `none` and `max`; the SDK's declaration lags.
    modelReasoningEffort: codexReasoningEffort(input.options?.reasoningEffort) as
      | ModelReasoningEffort
      | undefined,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    skipGitRepoCheck: true,
  };
}

function usageEvent(usage: Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    reasoningTokens: usage.reasoning_output_tokens,
  };
}

function updatedText(item: ThreadItem, seen: Map<string, string>): RunnerEvent | undefined {
  if (item.type !== "agent_message" && item.type !== "reasoning") return undefined;
  const previous = seen.get(item.id) ?? "";
  seen.set(item.id, item.text);
  if (item.text === previous) return undefined;
  const delta = item.text.startsWith(previous) ? item.text.slice(previous.length) : item.text;
  return item.type === "agent_message"
    ? { type: "text-delta", delta }
    : { type: "reasoning-delta", delta };
}

export function mapCodexEvent(
  event: ThreadEvent,
  seen: Map<string, string>,
): RunnerEvent | Error | undefined {
  switch (event.type) {
    case "thread.started":
      return { type: "provider-thread", threadId: event.thread_id };
    case "item.started":
    case "item.updated":
    case "item.completed":
      return updatedText(event.item, seen);
    case "turn.completed":
      return { type: "finish", finishReason: "stop", usage: usageEvent(event.usage) };
    case "turn.failed":
      return new Error(event.error.message);
    case "error":
      return new Error(event.message);
    default:
      return undefined;
  }
}

export class CodexRunner implements LocalAuthRunner {
  readonly descriptor = {
    id: "codex",
    name: "Codex",
    auth: "local-subscription",
    available: true,
    description: "Codex through the official local CLI and SDK using this device's sign-in.",
  } as const;

  private readonly cliExecutable: string;
  private readonly client: Codex;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.cliExecutable = env.CODEX_PATH?.trim() || "codex";
    // The packaged Electron runtime intentionally bundles JavaScript only.
    // Use the user's official CLI so its installation and credential store
    // remain owned by Codex instead of copying either into Monte Carlo.
    this.client = new Codex({
      codexPathOverride: this.cliExecutable,
      config: codexFastModeConfig(false),
    });
  }

  health(signal?: AbortSignal): Promise<ProviderHealth> {
    return this.authStatus(signal);
  }

  async authStatus(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const result = await runStatusCommand(this.cliExecutable, signal);
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
    const process = streamProcess(this.cliExecutable, ["login", "--device-auth"], signal);
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
      models: await readCodexModelCatalog(this.cliExecutable, signal),
      source: "cli",
      fetchedAt: Date.now(),
    };
  }

  async *run(input: ChatRequest, signal: AbortSignal): AsyncIterable<RunnerEvent> {
    const threadOptions = codexThreadOptions(input);
    const client = input.options?.fastMode
      ? new Codex({
          codexPathOverride: this.cliExecutable,
          config: codexFastModeConfig(true),
        })
      : this.client;
    const thread = input.providerThreadId
      ? client.resumeThread(input.providerThreadId, threadOptions)
      : client.startThread(threadOptions);
    const prompt = input.providerThreadId
      ? latestUserPrompt(input.messages)
      : transcriptPrompt(input.messages);
    const { events } = await thread.runStreamed(prompt, { signal });
    const seen = new Map<string, string>();

    for await (const event of events) {
      const mapped = mapCodexEvent(event, seen);
      if (mapped instanceof Error) throw mapped;
      if (mapped !== undefined) yield mapped;
    }
  }
}
