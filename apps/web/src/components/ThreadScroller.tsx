/** Applies consistent reader-controlled scrolling to every conversation thread. */

import {
  type CSSProperties,
  memo,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ThreadScrollBookmark } from "@/lib/sessionPresentationMemory";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerVisibility,
} from "./ui/message-scroller";

type ThreadScrollerProps = {
  ariaLabel?: string;
  buttonBottom?: CSSProperties["bottom"];
  buttonClassName?: string;
  children: ReactNode;
  contentClassName?: string;
  contentReady?: boolean;
  initialScrollBookmark?: ThreadScrollBookmark;
  onScroll?: UIEventHandler<HTMLDivElement>;
  onReadMessage?: (messageId: string) => Promise<boolean>;
  onScrollBookmarkChange?: (bookmark: ThreadScrollBookmark) => void;
  readMessageId?: string;
  readTrackingEnabled?: boolean;
  streaming: boolean;
  threadId: string;
  viewportClassName?: string;
  viewportTestId?: string;
};

export const ThreadScroller = memo(function ThreadScroller(props: ThreadScrollerProps) {
  return <ThreadScrollerSession key={props.threadId} {...props} />;
});

const ThreadScrollerSession = memo(function ThreadScrollerSession({
  ariaLabel,
  buttonBottom,
  buttonClassName,
  children,
  contentClassName,
  contentReady = true,
  initialScrollBookmark,
  onScroll,
  onReadMessage,
  onScrollBookmarkChange,
  readMessageId,
  readTrackingEnabled = true,
  streaming,
  threadId,
  viewportClassName,
  viewportTestId,
}: ThreadScrollerProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(contentReady);
  const defaultScrollPosition = initialScrollBookmark
    ? initialScrollBookmark.kind === "follow-latest"
      ? "end"
      : "start"
    : "last-anchor";
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const captureBookmarkRef = useRef<(viewport: HTMLDivElement | null) => void>(() => undefined);

  const setViewport = useCallback((viewport: HTMLDivElement | null) => {
    const previousViewport = viewportRef.current;
    if (previousViewport && previousViewport !== viewport) {
      captureBookmarkRef.current(previousViewport);
    }
    viewportRef.current = viewport;
  }, []);

  // lint-allow: no-direct-use-effect — commit initial hydration once without hiding later updates.
  useEffect(() => {
    if (contentReady) setOpened(true);
  }, [contentReady]);

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition={defaultScrollPosition}
      scrollPreviousItemPeek={PREVIOUS_ITEM_PEEK}
    >
      <ThreadScrollMemoryBridge
        contentMounted={opened}
        contentReady={contentReady}
        initialBookmark={initialScrollBookmark}
        onBookmarkChange={onScrollBookmarkChange}
        captureBookmarkRef={captureBookmarkRef}
        viewportRef={viewportRef}
      >
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport
            ref={setViewport}
            className={viewportClassName}
            data-testid={viewportTestId}
            aria-label={ariaLabel ?? t("chat.messages")}
            onScroll={onScroll}
          >
            <MessageScrollerContent
              className={contentClassName}
              aria-busy={!contentReady || streaming || undefined}
            >
              {opened ? (
                <>
                  <MessageScrollerItem
                    aria-hidden="true"
                    hidden
                    messageId={`thread-start-${threadId}`}
                  />
                  {children}
                </>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <ActionTooltip label={t("chat.scrollToLatest")} side="top">
            <ThreadScrollerLatestButton
              className={cn("z-20 size-8 rounded-full", buttonClassName)}
              label={t("chat.scrollToLatest")}
              style={buttonBottom === undefined ? undefined : { bottom: buttonBottom }}
            />
          </ActionTooltip>
        </MessageScroller>
        <ReadMessageObserver
          enabled={readTrackingEnabled}
          messageId={readMessageId}
          onReadMessage={onReadMessage}
        />
      </ThreadScrollMemoryBridge>
    </MessageScrollerProvider>
  );
});

function ThreadScrollerLatestButton({
  className,
  label,
  style,
}: {
  className: string;
  label: string;
  style?: CSSProperties;
}) {
  const { scrollToEnd } = useMessageScroller();
  return (
    <MessageScrollerButton
      className={className}
      label={label}
      onClick={(event) => {
        event.stopPropagation();
        scrollToEnd({ behavior: "auto" });
      }}
      style={style}
    />
  );
}

function ThreadScrollMemoryBridge({
  captureBookmarkRef,
  children,
  contentMounted,
  contentReady,
  initialBookmark,
  onBookmarkChange,
  viewportRef,
}: {
  captureBookmarkRef: RefObject<(viewport: HTMLDivElement | null) => void>;
  children: ReactNode;
  contentMounted: boolean;
  contentReady: boolean;
  initialBookmark?: ThreadScrollBookmark;
  onBookmarkChange?: (bookmark: ThreadScrollBookmark) => void;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const { scrollToEnd, scrollToMessage } = useMessageScroller();
  const restoredRef = useRef(!initialBookmark);
  const restoreFrameRef = useRef<number | null>(null);
  const onBookmarkChangeRef = useRef(onBookmarkChange);
  onBookmarkChangeRef.current = onBookmarkChange;

  const captureBookmark = useCallback((viewport: HTMLDivElement | null) => {
    const handleBookmarkChange = onBookmarkChangeRef.current;
    if (!viewport || !restoredRef.current || !handleBookmarkChange) return;
    const remaining = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    if (remaining <= SCROLL_END_THRESHOLD_PX) {
      handleBookmarkChange({ kind: "follow-latest" });
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const visibleItem = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
    });
    const messageId = visibleItem?.dataset.messageId;
    if (!visibleItem || !messageId) return;
    handleBookmarkChange({
      kind: "message-anchor",
      messageId,
      offset:
        (visibleItem.getBoundingClientRect().top - viewportRect.top) /
        getElementScale(viewport, viewportRect),
    });
  }, []);
  captureBookmarkRef.current = captureBookmark;

  // lint-allow: no-direct-use-effect — snapshot the live DOM before its owner unmounts.
  useLayoutEffect(() => {
    return () => captureBookmark(viewportRef.current);
  }, [captureBookmark, viewportRef]);

  // lint-allow: no-direct-use-effect — restore only after the opening content has hydrated.
  useLayoutEffect(() => {
    if (!contentMounted || !contentReady || restoredRef.current || !initialBookmark) return;
    if (initialBookmark.kind === "follow-latest") {
      if (scrollToEnd({ behavior: "auto" })) restoredRef.current = true;
      return;
    }

    // The primitive applies its default position in a parent layout effect.
    // Restore on the next frame so that initialization cannot overwrite the
    // semantic anchor, including inside transformed Canvas branch cards.
    restoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport || restoredRef.current) return;
      const target = Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]")).find(
        (item) => item.dataset.messageId === initialBookmark.messageId,
      );
      if (!target) {
        // The remembered message can disappear after a data change. Fall back
        // to the latest content instead of leaving the reader at the temporary
        // start position used to put the primitive in free-scrolling mode.
        if (scrollToEnd({ behavior: "auto" })) restoredRef.current = true;
        return;
      }

      const content = target.parentElement;
      const contentStyle = content ? window.getComputedStyle(content) : undefined;
      const paddingStart = Number.parseFloat(
        contentStyle?.paddingBlockStart || contentStyle?.paddingTop || "0",
      );
      const scrollMargin =
        initialBookmark.offset - (Number.isFinite(paddingStart) ? paddingStart : 0);
      scrollToMessage(initialBookmark.messageId, {
        align: "start",
        behavior: "auto",
        scrollMargin,
      });
      restoredRef.current = true;
    });

    return () => {
      if (restoreFrameRef.current === null) return;
      window.cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    };
  }, [contentMounted, contentReady, initialBookmark, scrollToEnd, scrollToMessage, viewportRef]);

  return children;
}

function getElementScale(element: HTMLElement, rect = element.getBoundingClientRect()): number {
  const scale = element.clientHeight > 0 ? rect.height / element.clientHeight : 1;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function ReadMessageObserver({
  enabled,
  messageId,
  onReadMessage,
}: {
  enabled: boolean;
  messageId?: string;
  onReadMessage?: (messageId: string) => Promise<boolean>;
}) {
  const { visibleMessageIds } = useMessageScrollerVisibility();
  const inFlightMessageIdRef = useRef<string | undefined>(undefined);
  const markedMessageIdRef = useRef<string | undefined>(undefined);
  const visible = Boolean(messageId && visibleMessageIds.includes(messageId));

  // lint-allow: no-direct-use-effect — viewport visibility and window focus define a read receipt.
  useEffect(() => {
    if (!enabled || !visible || !messageId || !onReadMessage) return;
    let disposed = false;
    let retryAttempt = 0;
    let retryTimer: number | undefined;
    const scheduleRetry = () => {
      const delay = READ_RETRY_DELAYS[retryAttempt];
      if (delay === undefined || disposed) return;
      retryAttempt += 1;
      retryTimer = window.setTimeout(markVisibleMessage, delay);
    };
    const markVisibleMessage = () => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      if (
        disposed ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        markedMessageIdRef.current === messageId ||
        inFlightMessageIdRef.current === messageId
      ) {
        return;
      }
      inFlightMessageIdRef.current = messageId;
      void onReadMessage(messageId)
        .catch(() => false)
        .then((marked) => {
          if (marked) {
            markedMessageIdRef.current = messageId;
            return;
          }
          scheduleRetry();
        })
        .finally(() => {
          if (inFlightMessageIdRef.current === messageId) {
            inFlightMessageIdRef.current = undefined;
          }
        });
    };
    const retryVisibleMessage = () => {
      retryAttempt = 0;
      markVisibleMessage();
    };

    markVisibleMessage();
    window.addEventListener("focus", retryVisibleMessage);
    document.addEventListener("visibilitychange", retryVisibleMessage);
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.removeEventListener("focus", retryVisibleMessage);
      document.removeEventListener("visibilitychange", retryVisibleMessage);
    };
  }, [enabled, messageId, onReadMessage, visible]);

  return null;
}

const PREVIOUS_ITEM_PEEK = 64;
const SCROLL_END_THRESHOLD_PX = 8;
const READ_RETRY_DELAYS = [750, 2_000, 5_000] as const;
