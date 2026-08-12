/** Verifies the renderer only announces one downloaded update per app session. */

import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadPromptModule() {
  vi.resetModules();
  return import("../../apps/web/src/lib/desktopUpdatePrompt");
}

describe("desktop update prompt", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("claims the prompt only once in a renderer", async () => {
    const storage = new Map<string, string>();
    const sessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    const { claimDesktopUpdateToast } = await loadPromptModule();

    expect(claimDesktopUpdateToast(sessionStorage)).toBe(true);
    expect(claimDesktopUpdateToast(sessionStorage)).toBe(false);
  });

  it("does not reclaim a prompt after a renderer reload", async () => {
    const { DESKTOP_UPDATE_TOAST_SESSION_KEY, claimDesktopUpdateToast } = await loadPromptModule();
    const sessionStorage = {
      getItem: (key: string) => (key === DESKTOP_UPDATE_TOAST_SESSION_KEY ? "true" : null),
      setItem: vi.fn(),
    };

    expect(claimDesktopUpdateToast(sessionStorage)).toBe(false);
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("falls back to renderer memory when session storage is blocked", async () => {
    const sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: vi.fn(),
    };
    const { claimDesktopUpdateToast } = await loadPromptModule();

    expect(claimDesktopUpdateToast(sessionStorage)).toBe(true);
    expect(claimDesktopUpdateToast(sessionStorage)).toBe(false);
  });
});
