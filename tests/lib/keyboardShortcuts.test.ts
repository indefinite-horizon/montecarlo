/** Verifies that shortcut matching and labels stay aligned across platforms. */

import { describe, expect, it } from "vitest";
import { appShortcutLabel, matchesAppShortcut } from "../../apps/web/src/lib/keyboardShortcuts";

function keyboardEvent(
  code: string,
  modifiers: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">> = {},
) {
  return {
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe("application keyboard shortcuts", () => {
  it("shows platform-correct labels", () => {
    expect(appShortcutLabel("commandPalette", "macos")).toBe("⌘K");
    expect(appShortcutLabel("newProject", "macos")).toBe("⌘⌥A");
    expect(appShortcutLabel("providerSelection", "macos")).toBe("⌥P");
    expect(appShortcutLabel("thinkingLevel", "windows")).toBe("Alt+T");
    expect(appShortcutLabel("newChat", "linux")).toBe("Ctrl+N");
  });

  it("matches macOS Option shortcuts by physical code", () => {
    expect(
      matchesAppShortcut(
        keyboardEvent("KeyA", { altKey: true, metaKey: true }),
        "newProject",
        "macos",
      ),
    ).toBe(true);
    expect(
      matchesAppShortcut(keyboardEvent("KeyP", { altKey: true }), "providerSelection", "macos"),
    ).toBe(true);
    expect(
      matchesAppShortcut(keyboardEvent("KeyT", { altKey: true }), "thinkingLevel", "macos"),
    ).toBe(true);
  });

  it("rejects extra modifiers and uses Ctrl on Windows and Linux", () => {
    expect(matchesAppShortcut(keyboardEvent("KeyN", { ctrlKey: true }), "newChat", "windows")).toBe(
      true,
    );
    expect(
      matchesAppShortcut(
        keyboardEvent("KeyN", { ctrlKey: true, shiftKey: true }),
        "newChat",
        "linux",
      ),
    ).toBe(false);
    expect(matchesAppShortcut(keyboardEvent("KeyN", { metaKey: true }), "newChat", "linux")).toBe(
      false,
    );
  });
});
