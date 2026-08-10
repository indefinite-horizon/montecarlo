/** Applies consistent reader-controlled scrolling to every conversation thread. */

import {
  type CSSProperties,
  memo,
  type ReactNode,
  type UIEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScrollerVisibility,
} from "./ui/message-scroller";

type ThreadScrollerProps = {
  ariaLabel?: string;
  buttonBottom?: CSSProperties["bottom"];
  buttonClassName?: string;
  children: ReactNode;
  contentClassName?: string;
  contentReady?: boolean;
  onScroll?: UIEventHandler<HTMLDivElement>;
  onReadMessage?: (messageId: string) => Promise<boolean>;
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
  onScroll,
  onReadMessage,
  readMessageId,
  readTrackingEnabled = true,
  streaming,
  threadId,
  viewportClassName,
  viewportTestId,
}: ThreadScrollerProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(contentReady);

  // lint-allow: no-direct-use-effect — commit initial hydration once without hiding later updates.
  useEffect(() => {
    if (contentReady) setOpened(true);
  }, [contentReady]);

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="last-anchor"
      scrollPreviousItemPeek={PREVIOUS_ITEM_PEEK}
    >
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport
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
          <MessageScrollerButton
            className={cn("z-20 size-8 rounded-full", buttonClassName)}
            label={t("chat.scrollToLatest")}
            onClick={(event) => event.stopPropagation()}
            style={buttonBottom === undefined ? undefined : { bottom: buttonBottom }}
          />
        </ActionTooltip>
      </MessageScroller>
      <ReadMessageObserver
        enabled={readTrackingEnabled}
        messageId={readMessageId}
        onReadMessage={onReadMessage}
      />
    </MessageScrollerProvider>
  );
});

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
const READ_RETRY_DELAYS = [750, 2_000, 5_000] as const;
