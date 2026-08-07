/** Connects global and desktop shortcuts to workspace actions. */

import { type Dispatch, type SetStateAction, useEffect } from "react";
import { matchesAppShortcut } from "@/lib/keyboardShortcuts";

type BooleanSetter = Dispatch<SetStateAction<boolean>>;

export function useWorkspaceShortcuts({
  blockingDialogOpen,
  loading,
  workspaceId,
  createNewChat,
  openProviderSelection,
  cycleThinkingLevel,
  setCommandPaletteOpen,
  setProjectCreateOpen,
  setProviderMenuOpen,
}: {
  blockingDialogOpen: boolean;
  loading: boolean;
  workspaceId?: string;
  createNewChat: () => Promise<boolean>;
  openProviderSelection: () => void;
  cycleThinkingLevel: () => void;
  setCommandPaletteOpen: BooleanSetter;
  setProjectCreateOpen: BooleanSetter;
  setProviderMenuOpen: BooleanSetter;
}) {
  // lint-allow: no-direct-use-effect — global shortcuts bridge document-level input to app actions.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || blockingDialogOpen) return;

      if (matchesAppShortcut(event, "commandPalette")) {
        event.preventDefault();
        setProviderMenuOpen(false);
        setCommandPaletteOpen((current) => !current);
        return;
      }
      if (matchesAppShortcut(event, "newChat")) {
        event.preventDefault();
        setCommandPaletteOpen(false);
        if (!loading && workspaceId) void createNewChat();
        return;
      }
      if (matchesAppShortcut(event, "newProject")) {
        event.preventDefault();
        setCommandPaletteOpen(false);
        if (!loading && workspaceId) setProjectCreateOpen(true);
        return;
      }
      if (matchesAppShortcut(event, "providerSelection")) {
        event.preventDefault();
        setCommandPaletteOpen(false);
        openProviderSelection();
        return;
      }
      if (matchesAppShortcut(event, "thinkingLevel")) {
        event.preventDefault();
        setCommandPaletteOpen(false);
        cycleThinkingLevel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    blockingDialogOpen,
    createNewChat,
    cycleThinkingLevel,
    loading,
    openProviderSelection,
    setCommandPaletteOpen,
    setProjectCreateOpen,
    setProviderMenuOpen,
    workspaceId,
  ]);

  // lint-allow: no-direct-use-effect — Electron forwards the native menu shortcut through preload.
  useEffect(() => {
    const bridge = window.monteCarloDesktop;
    if (!bridge?.onNewChat || !bridge.offNewChat) return;
    const handleNewChat = () => {
      if (!blockingDialogOpen && !loading && workspaceId) {
        setCommandPaletteOpen(false);
        setProviderMenuOpen(false);
        void createNewChat();
      }
    };
    bridge.onNewChat(handleNewChat);
    return () => bridge.offNewChat?.(handleNewChat);
  }, [
    blockingDialogOpen,
    createNewChat,
    loading,
    setCommandPaletteOpen,
    setProviderMenuOpen,
    workspaceId,
  ]);
}
