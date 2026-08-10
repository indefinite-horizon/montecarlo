/** Manages allowlisted Codex CLI child processes and cancellation. */

import { type ChildProcess, type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { AsyncQueue } from "../asyncQueue.js";
import { runtimeDefaults } from "../config.js";
import { sanitizeProcessOutput } from "../errors.js";

type ProcessEvent =
  | { type: "output"; value: string; stream: "stdout" | "stderr" }
  | { type: "close"; code: number | null }
  | { type: "failure"; error: Error };

export type CapturedChild = ChildProcessByStdio<null, Readable, Readable>;

const CODEX_CHILD_ENVIRONMENT_KEYS = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "USERNAME",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
] as const;

export function abortError(): Error {
  const error = new Error("The operation was cancelled.");
  error.name = "AbortError";
  return error;
}

export function terminateProcess(child: ChildProcess): NodeJS.Timeout | undefined {
  if (child.exitCode !== null || child.killed) return undefined;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, runtimeDefaults.processKillGraceMs);
  timer.unref();
  return timer;
}

export function codexChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const key of CODEX_CHILD_ENVIRONMENT_KEYS) {
    const value = env[key];
    if (value !== undefined) childEnvironment[key] = value;
  }
  childEnvironment.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = "monte_carlo";
  return childEnvironment;
}

export async function runStatusCommand(
  executable: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<{ code: number | null }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["login", "status"], {
      env,
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

export function streamProcess(
  executable: string,
  arguments_: readonly string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): { child: CapturedChild; events: AsyncQueue<ProcessEvent>; cleanup: () => void } {
  signal.throwIfAborted();
  const child = spawn(executable, [...arguments_], {
    env,
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
