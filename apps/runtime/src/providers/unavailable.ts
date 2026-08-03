/** Describes subscription connectors that are intentionally unavailable. */

import type { ChatRequest, ProviderHealth, Runner, RunnerEvent } from "../types.js";

export const claudeSubscriptionUnavailableReason =
  "Disabled: Anthropic does not permit third-party products to authenticate with Claude.ai Free, Pro, or Max credentials without prior written approval. Use the Anthropic API provider instead.";

export class ClaudeSubscriptionRunner implements Runner {
  readonly descriptor = {
    id: "claude-subscription",
    name: "Claude subscription",
    auth: "unavailable",
    available: false,
    description: "Reserved for a future Anthropic-approved subscription connector.",
    unavailableReason: claudeSubscriptionUnavailableReason,
  } as const;

  health(): Promise<ProviderHealth> {
    return Promise.resolve({
      status: "unavailable",
      authenticated: false,
      detail: claudeSubscriptionUnavailableReason,
    });
  }

  run(_input: ChatRequest, _signal: AbortSignal): AsyncIterable<RunnerEvent> {
    throw new Error(claudeSubscriptionUnavailableReason);
  }
}
