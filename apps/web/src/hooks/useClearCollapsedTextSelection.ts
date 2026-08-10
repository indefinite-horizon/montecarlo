/** Keeps floating text-selection UI synchronized with the browser selection. */

import { type Dispatch, type SetStateAction, useEffect } from "react";

export function useClearCollapsedTextSelection<T>(
  setSelection: Dispatch<SetStateAction<T | undefined>>,
  enabled = true,
) {
  // lint-allow: no-direct-use-effect — bridge browser selection state into React UI state.
  useEffect(() => {
    if (!enabled) return;

    const clearCollapsedSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setSelection(undefined);
      }
    };

    document.addEventListener("selectionchange", clearCollapsedSelection);
    return () => document.removeEventListener("selectionchange", clearCollapsedSelection);
  }, [enabled, setSelection]);
}
