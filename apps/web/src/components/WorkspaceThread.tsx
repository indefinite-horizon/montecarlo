/** Renders the focused branch with reader-controlled thread scrolling. */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatBranch, ChatMessage, SelectionAnchor } from "@/lib/conversation";
import { ChatTranscript } from "./ChatTranscript";
import { ThreadScroller } from "./ThreadScroller";
import { MessageScrollerItem } from "./ui/message-scroller";

export const WorkspaceThread = memo(function WorkspaceThread({
  activeBranch,
  contentReady,
  messages,
  onEditMessage,
  onClearSelection,
  onReadMessage,
  onRetryMessage,
  onSelectText,
  readMessageId,
  readTrackingEnabled,
  streaming,
  threadId,
}: {
  activeBranch?: ChatBranch;
  contentReady: boolean;
  messages: ChatMessage[];
  onEditMessage: (message: ChatMessage, content: string) => Promise<boolean>;
  onClearSelection: () => void;
  onReadMessage: (messageId: string) => Promise<boolean>;
  onRetryMessage: (message: ChatMessage) => Promise<boolean>;
  onSelectText: (anchor?: SelectionAnchor) => void;
  readMessageId?: string;
  readTrackingEnabled: boolean;
  streaming: boolean;
  threadId: string;
}) {
  const { t } = useTranslation();

  return (
    <ThreadScroller
      buttonBottom="10rem"
      contentClassName="gap-0 pb-40 pt-8"
      contentReady={contentReady}
      onScroll={onClearSelection}
      onReadMessage={onReadMessage}
      readMessageId={readMessageId}
      readTrackingEnabled={readTrackingEnabled}
      streaming={streaming}
      threadId={threadId}
      viewportTestId="transcript-scroller"
    >
      {activeBranch?.anchor?.selectedText ? (
        <MessageScrollerItem
          className="mx-auto mb-8 w-full max-w-3xl px-5 sm:px-8"
          messageId={`branch-context-${activeBranch.publicId ?? activeBranch.id}`}
        >
          <div className="rounded-lg border border-primary/20 bg-accent/45 px-4 py-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-primary">
              {t("branch.following")}
            </p>
            <p className="mt-1 line-clamp-2 font-display text-xs italic text-foreground/70">
              “{activeBranch.anchor.displayText ?? activeBranch.anchor.selectedText}”
            </p>
          </div>
        </MessageScrollerItem>
      ) : null}
      <ChatTranscript
        branchOrigin={
          activeBranch?.parentBranchId
            ? { branchId: activeBranch.id, createdAt: activeBranch.createdAt }
            : undefined
        }
        messages={messages}
        onEditMessage={onEditMessage}
        onRetryMessage={onRetryMessage}
        onSelectText={onSelectText}
      />
    </ThreadScroller>
  );
});
