/** Connects global and desktop shortcuts to workspace actions. */

import { type Dispatch, type SetStateAction, useCallback, useEffect } from "react";
import { matchesAppShortcut, workspaceShortcutIndex } from "@/lib/keyboardShortcuts";

type BooleanSetter = Dispatch<SetStateAction<boolean>>;
let lastShortcut: { id: string; time: number } | undefined;

export function useWorkspaceShortcuts({
  blockingDialogOpen,
  loading,
  workspaceId,
  workspaceIds,
  selectWorkspace,
  createNewChat,
  archiveFocusedChat,
  openProviderSelection,
  cycleThinkingLevel,
  toggleLeftSidebar,
  toggleRightSidebar,
  setCommandPaletteOpen,
  setProjectCreateOpen,
  setProviderMenuOpen,
}: {
  blockingDialogOpen: boolean;
  loading: boolean;
  workspaceId?: string;
  workspaceIds: string[];
  selectWorkspace: (workspaceId: string) => void;
  createNewChat: () => Promise<boolean>;
  archiveFocusedChat: () => Promise<void>;
  openProviderSelection: () => void;
  cycleThinkingLevel: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setCommandPaletteOpen: BooleanSetter;
  setProjectCreateOpen: BooleanSetter;
  setProviderMenuOpen: BooleanSetter;
}) {
  const runShortcut = useCallback((id: string, action: () => void) => {
    const time = performance.now();
    if (lastShortcut?.id === id && time - lastShortcut.time < 250) return;
    lastShortcut = { id, time };
    action();
  }, []);

  // lint-allow: no-direct-use-effect — global shortcuts bridge document-level input to app actions.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || blockingDialogOpen) return;

      const workspaceIndex = workspaceShortcutIndex(event);
      const targetWorkspaceId =
        workspaceIndex === undefined ? undefined : workspaceIds[workspaceIndex];
      if (targetWorkspaceId) {
        event.preventDefault();
        runShortcut(`workspace:${workspaceIndex}`, () => selectWorkspace(targetWorkspaceId));
        return;
      }

      if (matchesAppShortcut(event, "commandPalette")) {
        event.preventDefault();
        runShortcut("commandPalette", () => {
          setProviderMenuOpen(false);
          setCommandPaletteOpen((current) => !current);
        });
        return;
      }
      // Electron owns Cmd/Ctrl+N before the renderer sees it. Keeping one source of truth avoids
      // one physical keypress being delivered through both DOM and IPC.
      if (!window.monteCarloDesktop?.onNewChat && matchesAppShortcut(event, "newChat")) {
        event.preventDefault();
        runShortcut("newChat", () => {
          setCommandPaletteOpen(false);
          if (!loading && workspaceId) void createNewChat();
        });
        return;
      }
      if (matchesAppShortcut(event, "toggleLeftSidebar")) {
        event.preventDefault();
        runShortcut("toggleLeftSidebar", toggleLeftSidebar);
        return;
      }
      if (matchesAppShortcut(event, "toggleRightSidebar")) {
        event.preventDefault();
        runShortcut("toggleRightSidebar", toggleRightSidebar);
        return;
      }
      if (matchesAppShortcut(event, "newProject")) {
        event.preventDefault();
        runShortcut("newProject", () => {
          setCommandPaletteOpen(false);
          if (!loading && workspaceId) setProjectCreateOpen(true);
        });
        return;
      }
      if (matchesAppShortcut(event, "archiveChat")) {
        event.preventDefault();
        runShortcut("archiveChat", () => {
          setCommandPaletteOpen(false);
          setProviderMenuOpen(false);
          if (!loading && workspaceId) void archiveFocusedChat();
        });
        return;
      }
      if (matchesAppShortcut(event, "providerSelection")) {
        event.preventDefault();
        runShortcut("providerSelection", () => {
          setCommandPaletteOpen(false);
          openProviderSelection();
        });
        return;
      }
      if (matchesAppShortcut(event, "thinkingLevel")) {
        event.preventDefault();
        runShortcut("thinkingLevel", () => {
          setCommandPaletteOpen(false);
          cycleThinkingLevel();
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    blockingDialogOpen,
    archiveFocusedChat,
    createNewChat,
    cycleThinkingLevel,
    loading,
    openProviderSelection,
    runShortcut,
    setCommandPaletteOpen,
    setProjectCreateOpen,
    setProviderMenuOpen,
    selectWorkspace,
    toggleLeftSidebar,
    toggleRightSidebar,
    workspaceIds,
    workspaceId,
  ]);

  // lint-allow: no-direct-use-effect — Electron forwards the native menu shortcut through preload.
  useEffect(() => {
    const bridge = window.monteCarloDesktop;
    if (!bridge?.onNewChat || !bridge.offNewChat) return;
    const handleNewChat = () => {
      if (!blockingDialogOpen && !loading && workspaceId) {
        runShortcut("newChat", () => {
          setCommandPaletteOpen(false);
          setProviderMenuOpen(false);
          void createNewChat();
        });
      }
    };
    bridge.onNewChat(handleNewChat);
    return () => bridge.offNewChat?.(handleNewChat);
  }, [
    blockingDialogOpen,
    createNewChat,
    loading,
    runShortcut,
    setCommandPaletteOpen,
    setProviderMenuOpen,
    workspaceId,
  ]);
}
