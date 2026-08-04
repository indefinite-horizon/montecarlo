/** Renders the active branch lineage and turns text selections into branch anchors. */

import { UserRound } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage, SelectionAnchor } from "@/lib/conversation";
import { selectionAnchorFromMessage } from "@/lib/messageSelection";
import { cn } from "@/lib/utils";
import { MonteCarloBrand } from "./MonteCarloBrand";

export const ChatTranscript = memo(function ChatTranscript({
  messages,
  onSelectText,
}: {
  messages: ChatMessage[];
  onSelectText: (anchor: SelectionAnchor) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-40 pt-8 sm:px-8">
      {messages.map((message) => (
        <Message key={message.id} message={message} onSelectText={onSelectText} />
      ))}
    </div>
  );
});

const Message = memo(function Message({
  message,
  onSelectText,
}: {
  message: ChatMessage;
  onSelectText: (anchor: SelectionAnchor) => void;
}) {
  const { t } = useTranslation();

  if (message.role === "user") {
    return (
      <article className="mb-8 flex justify-end">
        <div className="max-w-[84%] rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-[15px] leading-6 shadow-sm">
          <div className="mb-1 flex items-center justify-end gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {t("chat.you")}
            <UserRound className="size-3" />
          </div>
          {message.content}
        </div>
      </article>
    );
  }

  if (message.role === "system" || message.isError) {
    return (
      <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-foreground/80">
        {message.content}
      </div>
    );
  }

  return (
    <article className="group mb-10 grid grid-cols-[32px_minmax(0,1fr)] gap-3">
      <MonteCarloBrand compact />
      <div className="min-w-0">
        <div className="mb-2 flex min-h-6 items-center gap-2">
          <span className="text-xs font-semibold">{t("chat.assistant")}</span>
          {message.model ? (
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[9px] text-muted-foreground">
              {message.model}
            </span>
          ) : null}
        </div>
        <div
          role="document"
          className={cn(
            "message-copy whitespace-pre-wrap select-text text-[15px] leading-[1.72] text-foreground/92",
            message.isStreaming && "streaming-caret",
          )}
          onMouseUp={(event) => {
            const anchor = selectionAnchorFromMessage(event.currentTarget, message);
            if (anchor) onSelectText(anchor);
          }}
        >
          {message.content}
        </div>
      </div>
    </article>
  );
});
