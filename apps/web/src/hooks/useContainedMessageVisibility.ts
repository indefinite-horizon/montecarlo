/** Tracks an exact message inside a transformed outer viewport. */

import { useCallback, useEffect, useRef, useState } from "react";

export function useContainedMessageVisibility(messageId?: string) {
  const rootRef = useRef<HTMLElement | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);
  const suspendedRef = useRef(false);
  const [visibleMessageId, setVisibleMessageId] = useState<string>();

  // lint-allow: no-direct-use-effect — observers bridge transformed canvas geometry into React.
  useEffect(() => {
    const root = rootRef.current;
    setVisibleMessageId(undefined);
    if (!root || !messageId) return;

    let observedTarget: HTMLElement | undefined;
    const updateFromGeometry = () => {
      if (suspendedRef.current || !observedTarget) {
        setVisibleMessageId(undefined);
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const targetRect = observedTarget.getBoundingClientRect();
      const intersects =
        targetRect.width > 0 &&
        targetRect.height > 0 &&
        targetRect.right > rootRect.left &&
        targetRect.left < rootRect.right &&
        targetRect.bottom > rootRect.top &&
        targetRect.top < rootRect.bottom;
      setVisibleMessageId(intersects ? messageId : undefined);
    };
    refreshRef.current = updateFromGeometry;

    const intersectionObserver = new IntersectionObserver(updateFromGeometry, {
      root,
      threshold: [0, 0.01],
    });
    const observeCurrentMessage = () => {
      const target = Array.from(root.querySelectorAll<HTMLElement>("[data-message-id]")).find(
        (candidate) => candidate.dataset.messageId === messageId,
      );
      if (target === observedTarget) return;
      intersectionObserver.disconnect();
      observedTarget = target;
      setVisibleMessageId(undefined);
      if (target) intersectionObserver.observe(target);
    };
    const mutationObserver = new MutationObserver(observeCurrentMessage);
    mutationObserver.observe(root, { childList: true, subtree: true });
    observeCurrentMessage();
    updateFromGeometry();
    return () => {
      refreshRef.current = () => undefined;
      mutationObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, [messageId]);

  const suspend = useCallback(() => {
    suspendedRef.current = true;
    setVisibleMessageId(undefined);
  }, []);
  const resume = useCallback(() => {
    suspendedRef.current = false;
    refreshRef.current();
  }, []);

  return {
    rootRef,
    visible: Boolean(messageId && visibleMessageId === messageId),
    suspend,
    resume,
  };
}
