/** Unit coverage for clipboard API and fallback behavior. */

// @vitest-environment happy-dom

import { afterEach, describe, expect, test, vi } from "vitest";
import { copyText } from "../../apps/web/src/lib/clipboard";

describe("copyText", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  test("uses the Clipboard API when it accepts the write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copyText("model output");

    expect(writeText).toHaveBeenCalledWith("model output");
  });

  test("falls back to a temporary selection and restores focus after a rejected write", async () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new DOMException("blocked")) },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await copyText("fallback output");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  test("rejects when both copy mechanisms fail and removes the temporary element", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });

    await expect(copyText("uncopied output")).rejects.toThrow("Copy command was rejected");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
