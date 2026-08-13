/** Verifies that shortcut matching and labels stay aligned across platforms. */

import { describe, expect, it } from "vitest";
import {
  appShortcutLabel,
  matchesAppShortcut,
  workspaceShortcutIndex,
  workspaceShortcutLabel,
} from "../../apps/web/src/lib/keyboardShortcuts";

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
    expect(appShortcutLabel("archiveChat", "macos")).toBe("⌘⇧A");
    expect(appShortcutLabel("providerSelection", "macos")).toBe("⌥P");
    expect(appShortcutLabel("thinkingLevel", "windows")).toBe("Alt+T");
    expect(appShortcutLabel("newChat", "linux")).toBe("Ctrl+Shift+N");
    expect(appShortcutLabel("archiveChat", "windows")).toBe("Ctrl+Shift+A");
    expect(appShortcutLabel("toggleLeftSidebar", "macos")).toBe("⌘B");
    expect(appShortcutLabel("toggleRightSidebar", "macos")).toBe("⌘⌥B");
    expect(appShortcutLabel("toggleRightSidebar", "linux")).toBe("Ctrl+Alt+B");
  });

  it("distinguishes left and right sidebar shortcuts", () => {
    expect(
      matchesAppShortcut(keyboardEvent("KeyB", { metaKey: true }), "toggleLeftSidebar", "macos"),
    ).toBe(true);
    expect(
      matchesAppShortcut(
        keyboardEvent("KeyB", { altKey: true, metaKey: true }),
        "toggleRightSidebar",
        "macos",
      ),
    ).toBe(true);
    expect(
      matchesAppShortcut(
        keyboardEvent("KeyB", { altKey: true, metaKey: true }),
        "toggleLeftSidebar",
        "macos",
      ),
    ).toBe(false);
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
    expect(
      matchesAppShortcut(
        keyboardEvent("KeyA", { metaKey: true, shiftKey: true }),
        "archiveChat",
        "macos",
      ),
    ).toBe(true);
  });

  it("labels and matches workspace shortcuts for the first nine workspaces", () => {
    expect(workspaceShortcutLabel(0, "macos")).toBe("⌥1");
    expect(workspaceShortcutLabel(8, "linux")).toBe("Alt+9");
    expect(workspaceShortcutLabel(9, "macos")).toBeUndefined();
    expect(workspaceShortcutIndex(keyboardEvent("Digit1", { altKey: true }))).toBe(0);
    expect(workspaceShortcutIndex(keyboardEvent("Digit9", { altKey: true }))).toBe(8);
    expect(
      workspaceShortcutIndex(keyboardEvent("Digit1", { altKey: true, metaKey: true })),
    ).toBeUndefined();
    expect(workspaceShortcutIndex(keyboardEvent("Numpad1", { altKey: true }))).toBeUndefined();
  });

  it("rejects extra modifiers and uses Ctrl on Windows and Linux", () => {
    expect(
      matchesAppShortcut(
        keyboardEvent("KeyN", { ctrlKey: true, shiftKey: true }),
        "newChat",
        "linux",
      ),
    ).toBe(true);
    expect(matchesAppShortcut(keyboardEvent("KeyN", { ctrlKey: true }), "newChat", "windows")).toBe(
      false,
    );
    expect(matchesAppShortcut(keyboardEvent("KeyN", { metaKey: true }), "newChat", "linux")).toBe(
      false,
    );
    expect(
      matchesAppShortcut(
        keyboardEvent("KeyA", { ctrlKey: true, shiftKey: true, altKey: true }),
        "archiveChat",
        "windows",
      ),
    ).toBe(false);
  });
});
