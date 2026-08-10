/** Verifies retry eligibility and source-message selection. */

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../apps/web/src/lib/conversation";
import { retrySourceForMessage } from "../../apps/web/src/lib/messageRetry";

function message(
  role: ChatMessage["role"],
  id: string,
  runStatus?: ChatMessage["runStatus"],
): ChatMessage {
  return { id, branchId: "branch", role, content: id, createdAt: 1, runStatus };
}

describe("retrySourceForMessage", () => {
  it("enables a user turn only after its completed response", () => {
    const messages = [message("user", "prompt"), message("assistant", "reply", "succeeded")];
    expect(retrySourceForMessage(messages, 0)?.id).toBe("prompt");
  });

  it("does not enable a user turn for running, failed, or missing responses", () => {
    expect(retrySourceForMessage([message("user", "prompt")], 0)).toBeUndefined();
    expect(
      retrySourceForMessage(
        [message("user", "prompt"), message("assistant", "reply", "failed")],
        0,
      ),
    ).toBeUndefined();
  });

  it("maps a completed assistant response back to its preceding user turn", () => {
    const messages = [message("user", "prompt"), message("assistant", "reply", "succeeded")];
    expect(retrySourceForMessage(messages, 1)?.id).toBe("prompt");
  });
});
