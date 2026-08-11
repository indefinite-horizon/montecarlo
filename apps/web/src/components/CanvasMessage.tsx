/** Renders a compact message inside a branch canvas card. */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage, SelectionAnchor } from "@/lib/conversation";
import { selectionAnchorFromMessage } from "@/lib/messageSelection";
import { cn } from "@/lib/utils";
import { CanvasStreamingState } from "./CanvasStreamingState";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageOutputActions } from "./MessageOutputActions";

export const CanvasMessage = memo(function CanvasMessage({
  message,
  onEdit,
  onRetry,
  onSelectText,
}: {
  message: ChatMessage;
  onEdit?: (content: string) => Promise<boolean>;
  onRetry?: () => Promise<boolean>;
  onSelectText: (anchor?: SelectionAnchor) => void;
}) {
  const { t } = useTranslation();

  if (message.role === "user") {
    return (
      <section className="group/output border-b border-border/60 bg-secondary/35 px-4 py-3.5">
        <div
          aria-label={t("chat.you")}
          className="markdown-message whitespace-pre-wrap font-display text-[14px] font-semibold leading-[1.5]"
          data-ph-mask
          role="document"
        >
          {message.content}
        </div>
        <MessageOutputActions
          className="mt-1 justify-end"
          message={message}
          onEdit={onEdit}
          onRetry={onRetry}
        />
      </section>
    );
  }

  if (message.role === "system" || message.isError) {
    return (
      <section
        className="markdown-message whitespace-pre-wrap border-b border-amber-500/20 bg-amber-500/8 px-4 py-3 text-[12px] leading-5 text-foreground/80"
        data-ph-mask
      >
        {message.content}
      </section>
    );
  }

  return (
    <section className="group/output border-b border-border/60 px-4 py-4">
      {message.content ? (
        <MarkdownMessage
          aria-label={t("chat.assistant")}
          content={message.content}
          streaming={message.isStreaming}
          role="document"
          className={cn(
            "message-copy--compact select-text text-[12.5px] leading-[1.65] text-foreground/88",
            message.isStreaming && "streaming-caret",
          )}
          onMouseUp={(event) =>
            onSelectText(selectionAnchorFromMessage(event.currentTarget, message))
          }
        />
      ) : null}
      {message.isStreaming && !message.content ? <CanvasStreamingState /> : null}
      <MessageOutputActions className="mt-1" message={message} onRetry={onRetry} />
    </section>
  );
});
