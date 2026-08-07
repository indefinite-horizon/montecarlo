/** Unit tests for portable reasoning options sent to OpenAI-compatible providers. */

import type { TextStreamPart, ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import type { RunnerEvent } from "../types.js";
import { aiSdkReasoningEffort, normalizeAiSdkStream } from "./aiSdk.js";

async function* streamParts(parts: unknown[]) {
  for (const part of parts) yield part as TextStreamPart<ToolSet>;
}

async function collectEvents(events: AsyncIterable<RunnerEvent>): Promise<RunnerEvent[]> {
  const collected: RunnerEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

const usage = {
  inputTokens: 3,
  outputTokens: 2,
  totalTokens: 5,
  inputTokenDetails: {
    noCacheTokens: 3,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokenDetails: {
    textTokens: 2,
    reasoningTokens: 0,
  },
};

describe("AI SDK reasoning effort", () => {
  it("bounds Ollama's unsupported extra-high level and explicitly disables reasoning", () => {
    expect(aiSdkReasoningEffort("ollama", "xhigh")).toBe("high");
    expect(aiSdkReasoningEffort("ollama", "max")).toBe("high");
    expect(aiSdkReasoningEffort("ollama", "minimal")).toBe("low");
    expect(aiSdkReasoningEffort("ollama", "none")).toBe("none");
  });

  it("preserves provider-specific OpenRouter reasoning levels", () => {
    expect(aiSdkReasoningEffort("openrouter", "xhigh")).toBe("xhigh");
  });

  it("keeps reasoning separate while emitting a visible response", async () => {
    await expect(
      collectEvents(
        normalizeAiSdkStream(
          streamParts([
            { type: "reasoning-delta", id: "reasoning-0", text: "private analysis" },
            { type: "text-delta", id: "text-0", text: "visible answer" },
            {
              type: "finish",
              finishReason: "stop",
              rawFinishReason: "stop",
              totalUsage: usage,
            },
          ]),
        ),
      ),
    ).resolves.toEqual([
      { type: "reasoning-delta", delta: "private analysis" },
      { type: "text-delta", delta: "visible answer" },
      {
        type: "finish",
        finishReason: "stop",
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
      },
    ]);
  });

  it("rejects a reasoning-only completion instead of reporting empty success", async () => {
    await expect(
      collectEvents(
        normalizeAiSdkStream(
          streamParts([
            { type: "reasoning-delta", id: "reasoning-0", text: "private analysis" },
            {
              type: "finish",
              finishReason: "length",
              rawFinishReason: "length",
              totalUsage: usage,
            },
          ]),
        ),
      ),
    ).rejects.toThrow("The provider finished without a text response.");
  });
});
