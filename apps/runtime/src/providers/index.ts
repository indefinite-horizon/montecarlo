/** Registers every supported and policy-gated model provider. */

import { RunnerRegistry } from "../registry.js";
import { createAnthropicRunner, createOllamaRunner, createOpenRouterRunner } from "./aiSdk.js";
import { CodexRunner } from "./codex.js";
import { ClaudeSubscriptionRunner } from "./unavailable.js";

export function createDefaultRegistry(env: NodeJS.ProcessEnv = process.env): RunnerRegistry {
  return new RunnerRegistry([
    new CodexRunner(env),
    createOpenRouterRunner(env),
    createOllamaRunner(env),
    createAnthropicRunner(env),
    new ClaudeSubscriptionRunner(),
  ]);
}
