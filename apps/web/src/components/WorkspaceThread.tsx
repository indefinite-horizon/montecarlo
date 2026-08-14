/** Renders the focused branch with reader-controlled thread scrolling. */

import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  type ChatBranch,
  type ChatMessage,
  childBranchesBySourceMessage,
  type SelectionAnchor,
} from "@/lib/conversation";
import type { ThreadScrollBookmark } from "@/lib/sessionPresentationMemory";
import { ChatTranscript } from "./ChatTranscript";
import { ThreadScroller } from "./ThreadScroller";
import { MessageScrollerItem } from "./ui/message-scroller";

export const WorkspaceThread = memo(function WorkspaceThread({
  activeBranch,
  branches,
  contentReady,
  initialScrollBookmark,
  messages,
  onEditMessage,
  onClearSelection,
  onReadMessage,
  onScrollBookmarkChange,
  onRetryMessage,
  onSelectBranch,
  onSelectText,
  readMessageId,
  readTrackingEnabled,
  streaming,
  threadId,
}: {
  activeBranch?: ChatBranch;
  branches: ChatBranch[];
  contentReady: boolean;
  initialScrollBookmark?: ThreadScrollBookmark;
  messages: ChatMessage[];
  onEditMessage: (message: ChatMessage, content: string) => Promise<boolean>;
  onClearSelection: () => void;
  onReadMessage: (messageId: string) => Promise<boolean>;
  onScrollBookmarkChange?: (bookmark: ThreadScrollBookmark) => void;
  onRetryMessage: (message: ChatMessage) => Promise<boolean>;
  onSelectBranch: (branchId: string) => void;
  onSelectText: (anchor?: SelectionAnchor) => void;
  readMessageId?: string;
  readTrackingEnabled: boolean;
  streaming: boolean;
  threadId: string;
}) {
  const { t } = useTranslation();
  const childBranchesByMessageId = useMemo(
    () => childBranchesBySourceMessage(branches, activeBranch?.id ?? ""),
    [activeBranch?.id, branches],
  );

  return (
    <ThreadScroller
      buttonBottom="10rem"
      contentClassName="gap-0 pb-40 pt-8"
      contentReady={contentReady}
      initialScrollBookmark={initialScrollBookmark}
      onScroll={onClearSelection}
      onReadMessage={onReadMessage}
      onScrollBookmarkChange={onScrollBookmarkChange}
      readMessageId={readMessageId}
      readTrackingEnabled={readTrackingEnabled}
      streaming={streaming}
      threadId={threadId}
      viewportTestId="transcript-scroller"
    >
      {activeBranch?.anchor?.selectedText ? (
        <MessageScrollerItem
          className="mx-auto mb-8 w-full max-w-4xl px-5 sm:px-8"
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
            ? {
                branchId: activeBranch.id,
                parentBranchId: activeBranch.parentBranchId,
                createdAt: activeBranch.createdAt,
              }
            : undefined
        }
        childBranchesByMessageId={childBranchesByMessageId}
        messages={messages}
        onEditMessage={onEditMessage}
        onRetryMessage={onRetryMessage}
        onSelectBranch={onSelectBranch}
        onSelectText={onSelectText}
      />
    </ThreadScroller>
  );
});
