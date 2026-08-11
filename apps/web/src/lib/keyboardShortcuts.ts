/** Defines platform-aware keyboard shortcuts and keeps matching aligned with displayed hints. */

export type ShortcutPlatform = "macos" | "windows" | "linux";
export type ShortcutModifier = "meta" | "control" | "alt" | "shift";

export type KeyboardShortcut = {
  code: string;
  key: string;
  macos: readonly ShortcutModifier[];
  windowsLinux: readonly ShortcutModifier[];
};

export const appShortcuts = {
  commandPalette: {
    code: "KeyK",
    key: "K",
    macos: ["meta"],
    windowsLinux: ["control"],
  },
  newChat: {
    code: "KeyN",
    key: "N",
    macos: ["meta"],
    windowsLinux: ["control", "shift"],
  },
  newProject: {
    code: "KeyA",
    key: "A",
    macos: ["meta", "alt"],
    windowsLinux: ["control", "alt"],
  },
  archiveChat: {
    code: "KeyA",
    key: "A",
    macos: ["meta", "shift"],
    windowsLinux: ["control", "shift"],
  },
  providerSelection: {
    code: "KeyP",
    key: "P",
    macos: ["alt"],
    windowsLinux: ["alt"],
  },
  thinkingLevel: {
    code: "KeyT",
    key: "T",
    macos: ["alt"],
    windowsLinux: ["alt"],
  },
} as const satisfies Record<string, KeyboardShortcut>;

export type AppShortcutId = keyof typeof appShortcuts;

type DesktopPlatformWindow = Window & {
  monteCarloDesktop?: { platform?: string };
};

export function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof window !== "undefined") {
    const desktopPlatform = (window as DesktopPlatformWindow).monteCarloDesktop?.platform;
    if (desktopPlatform === "darwin") return "macos";
    if (desktopPlatform === "win32") return "windows";
    if (desktopPlatform === "linux") return "linux";
  }

  if (typeof navigator === "undefined") return "linux";
  const platform = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  if (/mac|iphone|ipad|ipod/iu.test(platform)) return "macos";
  if (/win/iu.test(platform)) return "windows";
  return "linux";
}

export function isMacOS(platform = detectShortcutPlatform()): boolean {
  return platform === "macos";
}

const macModifierLabels: Record<ShortcutModifier, string> = {
  meta: "⌘",
  control: "⌃",
  alt: "⌥",
  shift: "⇧",
};

const otherModifierLabels: Record<ShortcutModifier, string> = {
  meta: "Meta",
  control: "Ctrl",
  alt: "Alt",
  shift: "Shift",
};

export function shortcutLabel(
  shortcut: KeyboardShortcut,
  platform = detectShortcutPlatform(),
): string {
  const macos = platform === "macos";
  const modifiers = macos ? shortcut.macos : shortcut.windowsLinux;
  const labels = modifiers.map((modifier) =>
    macos ? macModifierLabels[modifier] : otherModifierLabels[modifier],
  );
  return macos ? `${labels.join("")}${shortcut.key}` : [...labels, shortcut.key].join("+");
}

export function appShortcutLabel(id: AppShortcutId, platform = detectShortcutPlatform()): string {
  return shortcutLabel(appShortcuts[id], platform);
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey">,
  shortcut: KeyboardShortcut,
  platform = detectShortcutPlatform(),
): boolean {
  if (event.code !== shortcut.code) return false;
  const modifiers = new Set(platform === "macos" ? shortcut.macos : shortcut.windowsLinux);
  return (
    event.metaKey === modifiers.has("meta") &&
    event.ctrlKey === modifiers.has("control") &&
    event.altKey === modifiers.has("alt") &&
    event.shiftKey === modifiers.has("shift")
  );
}

export function matchesAppShortcut(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey">,
  id: AppShortcutId,
  platform = detectShortcutPlatform(),
): boolean {
  return matchesShortcut(event, appShortcuts[id], platform);
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], [type='file']",
    ),
  );
}
