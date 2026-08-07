/** Registers every supported and policy-gated model provider. */

import { RunnerRegistry } from "../registry.js";
import { createOllamaRunner, createOpenRouterRunner } from "./aiSdk.js";
import { ClaudeRunner } from "./claude.js";
import { CodexRunner } from "./codex.js";

export function createDefaultRegistry(env: NodeJS.ProcessEnv = process.env): RunnerRegistry {
  return new RunnerRegistry([
    new CodexRunner(env),
    new ClaudeRunner(env),
    createOllamaRunner(env),
    createOpenRouterRunner(env),
  ]);
}
