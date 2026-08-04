/** Frontend-only provider defaults shared by controller and provider UI. */

import type { ProviderId } from "./conversation";

export const defaultProviderModels = {
  codex: "gpt-5.6-sol",
  anthropic: "sonnet",
  ollama: "qwen3:8b",
  openrouter: "anthropic/claude-sonnet-4.6",
} as const satisfies Record<ProviderId, string>;
