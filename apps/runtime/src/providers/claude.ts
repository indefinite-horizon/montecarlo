/** Runs Claude through the user's official CLI and Claude Pro/Max sign-in. */

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { runtimeDefaults } from "../config.js";
import { sanitizeProcessOutput } from "../errors.js";
import type {
  AuthEvent,
  ChatRequest,
  LocalAuthRunner,
  ProviderHealth,
  RunnerEvent,
  TokenUsage,
} from "../types.js";
import { transcriptPrompt } from "./codex.js";

function abortError(): Error {
  const error = new Error("The operation was cancelled.");
  error.name = "AbortError";
  return error;
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, runtimeDefaults.processKillGraceMs);
  timer.unref();
}

function textFromMessage(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const message = (value as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) =>
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : [],
  );
}

function usageFromResult(value: unknown): TokenUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = (value as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  const inputTokens = typeof record.input_tokens === "number" ? record.input_tokens : undefined;
  const outputTokens = typeof record.output_tokens === "number" ? record.output_tokens : undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined,
    cachedInputTokens:
      typeof record.cache_read_input_tokens === "number"
        ? record.cache_read_input_tokens
        : undefined,
  };
}

async function processExit(child: ChildProcess, signal?: AbortSignal): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, runtimeDefaults.providerHealthTimeoutMs);
    timeout.unref();
    const onAbort = () => terminate(child);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) reject(abortError());
      else if (timedOut) resolve(null);
      else resolve(code);
    });
  });
}

async function waitForExit(child: ChildProcess, signal: AbortSignal): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const onAbort = () => terminate(child);
    signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", reject);
    child.once("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(abortError());
      else resolve(code);
    });
  });
}

export class ClaudeRunner implements LocalAuthRunner {
  readonly descriptor = {
    id: "anthropic",
    name: "Claude",
    auth: "local-subscription",
    available: true,
    description: "Claude through the official local CLI using this device's Pro or Max sign-in.",
  } as const;

  private readonly executable: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.executable = env.CLAUDE_PATH?.trim() || "claude";
  }

  health(signal?: AbortSignal): Promise<ProviderHealth> {
    return this.authStatus(signal);
  }

  async authStatus(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const child = spawn(this.executable, ["auth", "status"], {
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
      const code = await processExit(child, signal);
      return code === 0
        ? { status: "ready", authenticated: true, detail: "Claude is signed in on this device." }
        : {
            status: "needs-configuration",
            authenticated: false,
            detail: "Sign in to Claude Pro or Max on this device.",
          };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        status: "unavailable",
        authenticated: false,
        detail: "The Claude CLI is unavailable on this device.",
      };
    }
  }

  async *deviceLogin(signal: AbortSignal): AsyncIterable<AuthEvent> {
    yield { type: "status", status: "starting", message: "Starting the official Claude CLI." };
    const child = spawn(this.executable, ["auth", "login"], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const outputs: Array<{ delta: string; stream: "stdout" | "stderr" }> = [];
    const push = (stream: "stdout" | "stderr") => (chunk: Buffer | string) => {
      const delta = sanitizeProcessOutput(chunk.toString());
      if (delta) outputs.push({ delta, stream });
    };
    child.stdout.on("data", push("stdout"));
    child.stderr.on("data", push("stderr"));
    const onAbort = () => terminate(child);
    signal.addEventListener("abort", onAbort, { once: true });
    const exit = waitForExit(child, signal);
    try {
      yield { type: "status", status: "waiting", message: "Complete sign-in in your browser." };
      const code = await exit;
      for (const output of outputs) yield { type: "output", ...output };
      if (code !== 0) throw new Error("Claude login ended before sign-in completed.");
      yield { type: "finish", success: true };
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) terminate(child);
    }
  }

  async *run(input: ChatRequest, signal: AbortSignal): AsyncIterable<RunnerEvent> {
    signal.throwIfAborted();
    const child = spawn(
      this.executable,
      [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        input.model,
        "--tools",
        "",
      ],
      { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const onAbort = () => terminate(child);
    signal.addEventListener("abort", onAbort, { once: true });
    const exit = waitForExit(child, signal);
    child.stdin.end(transcriptPrompt(input.messages));
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${sanitizeProcessOutput(chunk.toString())}`.slice(-2_000);
    });
    try {
      const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
      let sawFinish = false;
      for await (const line of lines) {
        if (!line.trim()) continue;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof event !== "object" || event === null) continue;
        const type = (event as { type?: unknown }).type;
        if (type === "system" && (event as { subtype?: unknown }).subtype === "init") {
          const sessionId = (event as { session_id?: unknown }).session_id;
          if (typeof sessionId === "string") yield { type: "provider-thread", threadId: sessionId };
        } else if (type === "assistant") {
          for (const text of textFromMessage(event)) yield { type: "text-delta", delta: text };
        } else if (type === "result") {
          if ((event as { is_error?: unknown }).is_error === true) {
            throw new Error("The Claude turn failed.");
          }
          sawFinish = true;
          yield { type: "finish", finishReason: "stop", usage: usageFromResult(event) };
        }
      }
      const code = await exit;
      if (signal.aborted) throw abortError();
      if (code !== 0 || !sawFinish) throw new Error(stderr || "The Claude turn failed.");
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) terminate(child);
    }
  }
}
