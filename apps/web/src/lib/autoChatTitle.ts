/** Runs the non-blocking model request that replaces an initial conversation title. */

import { chatTitlePrompt, normalizeGeneratedChatTitle } from "./chatNaming";
import type { ProviderId } from "./conversation";
import { streamRuntimeChat } from "./runtimeClient";

export function startAutomaticChatTitle({
  claim,
  complete,
  release,
  signal,
}: {
  claim: () => Promise<{ intent: string; provider: ProviderId; model: string } | null>;
  complete: (title: string) => Promise<boolean>;
  release: () => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<"not-claimed" | "completed" | "failed"> {
  return (async () => {
    let claimResult: { intent: string; provider: ProviderId; model: string } | null = null;
    let completed = false;
    let generatedTitle = "";
    try {
      claimResult = await claim();
      if (!claimResult) return "not-claimed";
      await streamRuntimeChat({
        provider: claimResult.provider,
        model: claimResult.model,
        messages: [],
        prompt: chatTitlePrompt(claimResult.intent),
        reasoningEffort: "none",
        fastMode: false,
        signal: signal ?? new AbortController().signal,
        onEvent: (event) => {
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "text-delta") generatedTitle += event.delta;
        },
      });
      const title = normalizeGeneratedChatTitle(generatedTitle);
      if (title) completed = await complete(title);
      return completed ? "completed" : "failed";
    } catch {
      return "failed";
    } finally {
      if (claimResult && !completed) {
        try {
          await release();
        } catch {
          // A later lease holder or completed title owns the state now.
        }
      }
    }
  })();
}
