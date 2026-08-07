/** Verifies hidden chat naming claims, model options, and failure recovery. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const streamRuntimeChat = vi.hoisted(() => vi.fn());

vi.mock("../../apps/web/src/lib/runtimeClient", () => ({ streamRuntimeChat }));

import { startAutomaticChatTitle } from "../../apps/web/src/lib/autoChatTitle";

describe("startAutomaticChatTitle", () => {
  beforeEach(() => {
    streamRuntimeChat.mockReset();
  });

  it("uses the selected model with thinking and fast mode disabled", async () => {
    streamRuntimeChat.mockImplementation(
      async (input: { onEvent: (event: { type: "text-delta"; delta: string }) => void }) => {
        input.onEvent({ type: "text-delta", delta: "Plan launch campaign" });
      },
    );
    const complete = vi.fn(async () => true);
    const release = vi.fn(async () => true);

    void startAutomaticChatTitle({
      claim: async () => ({
        intent: "Help me plan a launch campaign",
        provider: "codex",
        model: "gpt-test",
      }),
      complete,
      release,
    });

    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith("Plan launch campaign"));
    expect(streamRuntimeChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        model: "gpt-test",
        messages: [],
        reasoningEffort: "none",
        fastMode: false,
      }),
    );
    expect(release).not.toHaveBeenCalled();
  });

  it("releases the claim when generation fails", async () => {
    streamRuntimeChat.mockRejectedValue(new Error("offline"));
    const release = vi.fn(async () => true);

    void startAutomaticChatTitle({
      claim: async () => ({
        intent: "Summarize these notes",
        provider: "anthropic",
        model: "claude-test",
      }),
      complete: vi.fn(async () => true),
      release,
    });

    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
  });

  it("does nothing when another request owns the first-prompt claim", async () => {
    void startAutomaticChatTitle({
      claim: async () => null,
      complete: vi.fn(async () => true),
      release: vi.fn(async () => true),
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(streamRuntimeChat).not.toHaveBeenCalled();
  });
});
