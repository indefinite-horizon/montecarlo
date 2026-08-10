/** Renders the active branch lineage and turns text selections into branch anchors. */

import { Fragment, memo } from "react";
import { useTranslation } from "react-i18next";
import { type ChatMessage, messageScrollId, type SelectionAnchor } from "@/lib/conversation";
import { retrySourceForMessage } from "@/lib/messageRetry";
import { selectionAnchorFromMessage } from "@/lib/messageSelection";
import { cn } from "@/lib/utils";
import { BranchOriginDivider } from "./BranchOriginDivider";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageOutputActions } from "./MessageOutputActions";
import { MessageScrollerItem } from "./ui/message-scroller";

export const ChatTranscript = memo(function ChatTranscript({
  branchOrigin,
  messages,
  onEditMessage,
  onRetryMessage,
  onSelectText,
}: {
  branchOrigin?: { branchId: string; createdAt: number };
  messages: ChatMessage[];
  onEditMessage: (message: ChatMessage, content: string) => Promise<boolean>;
  onRetryMessage: (message: ChatMessage) => Promise<boolean>;
  onSelectText: (anchor?: SelectionAnchor) => void;
}) {
  const branchOriginIndex = branchOrigin
    ? messages.findIndex((message) => message.branchId === branchOrigin.branchId)
    : -1;
  const dividerIndex = branchOrigin
    ? branchOriginIndex < 0
      ? messages.length
      : branchOriginIndex
    : -1;

  return (
    <>
      {messages.map((message, index) => (
        <Fragment key={messageScrollId(message)}>
          {branchOrigin && index === dividerIndex ? (
            <BranchOriginDivider createdAt={branchOrigin.createdAt} />
          ) : null}
          <MessageScrollerItem
            className={cn(
              "mx-auto w-full max-w-3xl px-5 sm:px-8",
              message.isStreaming && "[overflow-anchor:none]",
            )}
            messageId={messageScrollId(message)}
            scrollAnchor={message.role === "user"}
          >
            <Message
              message={message}
              onEditMessage={onEditMessage}
              onRetryMessage={onRetryMessage}
              onSelectText={onSelectText}
              retrySource={retrySourceForMessage(messages, index)}
            />
          </MessageScrollerItem>
        </Fragment>
      ))}
      {branchOrigin && dividerIndex === messages.length ? (
        <BranchOriginDivider createdAt={branchOrigin.createdAt} />
      ) : null}
    </>
  );
});

const Message = memo(function Message({
  message,
  onEditMessage,
  onRetryMessage,
  onSelectText,
  retrySource,
}: {
  message: ChatMessage;
  onEditMessage: (message: ChatMessage, content: string) => Promise<boolean>;
  onRetryMessage: (message: ChatMessage) => Promise<boolean>;
  onSelectText: (anchor?: SelectionAnchor) => void;
  retrySource?: ChatMessage;
}) {
  const { t } = useTranslation();

  if (message.role === "user") {
    return (
      <article aria-label={t("chat.you")} className="group/output mb-8 flex flex-col items-end">
        <div
          className="markdown-message max-w-[84%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-secondary px-4 py-3 text-[15px] leading-6 shadow-sm"
          data-ph-mask
        >
          {message.content}
        </div>
        <MessageOutputActions
          className="justify-end"
          message={message}
          onEdit={(content) => onEditMessage(message, content)}
          onRetry={retrySource ? () => onRetryMessage(retrySource) : undefined}
        />
      </article>
    );
  }

  if (message.role === "system" || message.isError) {
    return (
      <div
        className="markdown-message mb-8 whitespace-pre-wrap rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-foreground/80"
        data-ph-mask
      >
        {message.content}
      </div>
    );
  }

  return (
    <article aria-label={t("chat.assistant")} className="group/output mb-10 min-w-0">
      <MarkdownMessage
        content={message.content}
        streaming={message.isStreaming}
        role="document"
        className={cn(
          "select-text text-[15px] leading-[1.72] text-foreground/92",
          message.isStreaming && "streaming-caret",
        )}
        onMouseUp={(event) =>
          onSelectText(selectionAnchorFromMessage(event.currentTarget, message))
        }
      />
      <MessageOutputActions
        message={message}
        onRetry={retrySource ? () => onRetryMessage(retrySource) : undefined}
      />
    </article>
  );
});
