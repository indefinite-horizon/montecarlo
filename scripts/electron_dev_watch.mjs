/** Restarts Electron main/preload/runtime code while Vite handles renderer HMR. */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, watch } from "node:fs";
import path from "node:path";
import process from "node:process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const electronExecutable = path.join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);
const mainEntrypoint = path.join(repositoryRoot, "apps", "desktop", "src", "main.cjs");
const watchRoots = [
  path.join(repositoryRoot, "apps", "desktop", "src"),
  path.join(repositoryRoot, "apps", "runtime", "src"),
];
const restartDebounceMs = 180;
const gracefulStopMs = 5_000;

if (!existsSync(electronExecutable)) {
  throw new Error(`Electron is not installed at ${electronExecutable}. Run bun install first.`);
}

let electronProcess;
let restartTimer;
let restarting = false;
let shuttingDown = false;

function directoriesUnder(root) {
  const directories = [root];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    directories.push(...directoriesUnder(path.join(root, entry.name)));
  }
  return directories;
}

function launchElectron() {
  if (shuttingDown) return;
  const child = spawn(electronExecutable, [mainEntrypoint], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      BUN_EXECUTABLE: process.env.BUN_EXECUTABLE || process.execPath,
    },
    stdio: "inherit",
  });
  electronProcess = child;
  child.once("exit", (code, signal) => {
    if (electronProcess === child) electronProcess = undefined;
    if (restarting || shuttingDown) return;
    process.stderr.write(
      `Electron exited unexpectedly (${signal ?? `exit ${code ?? "unknown"}`}).\n`,
    );
    process.exitCode = code && code !== 0 ? code : 1;
    void shutdown();
  });
  child.once("error", (error) => {
    if (restarting || shuttingDown) return;
    process.stderr.write(`Electron could not start: ${error.message}\n`);
    process.exitCode = 1;
    void shutdown();
  });
}

async function stopElectron() {
  const child = electronProcess;
  electronProcess = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (!child.kill("SIGKILL")) finish();
    }, gracefulStopMs);
    forceTimer.unref();
    child.once("exit", finish);
    if (!child.kill("SIGTERM")) finish();
  });
}

async function restartElectron() {
  if (shuttingDown || restarting) return;
  restarting = true;
  process.stdout.write("Desktop main-process change detected; restarting Electron…\n");
  await stopElectron();
  restarting = false;
  launchElectron();
}

function scheduleRestart(_eventType, filename) {
  if (shuttingDown || !filename || filename.endsWith(".test.cjs")) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => void restartElectron(), restartDebounceMs);
}

const watchers = watchRoots.flatMap((root) =>
  directoriesUnder(root).map((directory) => watch(directory, scheduleRestart)),
);

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  for (const watcher of watchers) watcher.close();
  await stopElectron();
  if (signal) process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

launchElectron();
