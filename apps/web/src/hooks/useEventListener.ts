/** Provides a stable event-listener hook for window and document events. */

import { useEffect, useRef } from "react";

/**
 * Attach an event listener to `window` (default) or `document` that auto-cleans up.
 * The handler is always up-to-date via a ref (no stale closures).
 *
 * See .agents/rules/react-no-direct-use-effect.md.
 */
export function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: { enabled?: boolean; capture?: boolean; target?: "window" | "document" },
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const enabled = options?.enabled ?? true;
  const capture = options?.capture ?? false;
  const target = options?.target ?? "window";

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: WindowEventMap[K]) => handlerRef.current(event);
    const el = target === "document" ? document : window;
    el.addEventListener(eventName, listener as EventListener, { capture });
    return () => el.removeEventListener(eventName, listener as EventListener, { capture });
  }, [eventName, enabled, capture, target]);
}
