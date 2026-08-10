/** Renders one chat row with activity, unread, archive, and contextual actions. */

import { Archive, Link2, LoaderCircle, Mail, Pencil, Pin, PinOff } from "lucide-react";
import { memo, useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatSummary } from "@/lib/conversation";
import { matchesAppShortcut } from "@/lib/keyboardShortcuts";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "./ui/context-menu";

export const SidebarChatRow = memo(function SidebarChatRow({
  chat,
  active,
  archiveShortcut,
  onArchive,
  onCopyLink,
  onMarkUnread,
  onRename,
  onSetPinned,
  onSelect,
}: {
  chat: ChatSummary;
  active: boolean;
  archiveShortcut: string;
  onArchive: (chatId: string) => void;
  onCopyLink: (chatId: string) => void;
  onMarkUnread: (chatId: string) => void;
  onRename: (chatId: string) => void;
  onSetPinned: (chatId: string, pinned: boolean) => void;
  onSelect: (chatId: string) => void;
}) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const statusDescription = [
    chat.hasOngoingResponse ? t("sidebar.responding") : undefined,
    chat.isUnread ? t("sidebar.unread") : undefined,
  ]
    .filter(Boolean)
    .join(". ");
  const handleMenuShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (event.repeat) return;
      const plainKey = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      let action: (() => void) | undefined;
      if (plainKey && event.code === "KeyR") {
        action = () => onMarkUnread(chat.id);
      } else if (plainKey && event.code === "KeyP") {
        action = () => onSetPinned(chat.id, !chat.isPinned);
      } else if (matchesAppShortcut(event, "archiveChat")) {
        action = () => onArchive(chat.id);
      }
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      action();
    },
    [chat.id, chat.isPinned, onArchive, onMarkUnread, onSetPinned],
  );

  // lint-allow: no-direct-use-effect — the listener exists only while this chat menu is open.
  useEffect(() => {
    if (!menuOpen) return;
    window.addEventListener("keydown", handleMenuShortcut, true);
    return () => window.removeEventListener("keydown", handleMenuShortcut, true);
  }, [handleMenuShortcut, menuOpen]);

  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          data-testid="chat-row"
          data-chat-id={chat.publicId ?? chat.id}
          data-ongoing-response={chat.hasOngoingResponse ? "true" : "false"}
          data-pinned={chat.isPinned ? "true" : "false"}
          data-unread={chat.isUnread ? "true" : "false"}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group/chat relative flex h-9 w-full items-center rounded-lg text-sm outline-none transition-colors",
            active
              ? "bg-accent/85 text-accent-foreground"
              : "text-muted-foreground hover:bg-card/80 hover:text-foreground focus-within:bg-card/80 focus-within:text-foreground",
          )}
        >
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-2 text-left outline-none"
            onClick={() => onSelect(chat.id)}
            aria-current={active ? "page" : undefined}
            aria-describedby={statusDescription ? descriptionId : undefined}
            aria-busy={chat.hasOngoingResponse || undefined}
          >
            <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
              {chat.hasOngoingResponse ? (
                <LoaderCircle
                  className="size-3.5 animate-spin text-primary motion-reduce:animate-none"
                  data-testid="chat-response-spinner"
                />
              ) : null}
            </span>
            <span
              data-testid="chat-title"
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                chat.isUnread
                  ? "font-semibold text-foreground"
                  : "font-normal text-muted-foreground",
              )}
            >
              {chat.title}
            </span>
            {chat.branchCount > 1 ? (
              <span className="rounded-full border border-border bg-background px-1.5 text-[9px] tabular-nums">
                {chat.branchCount}
              </span>
            ) : null}
          </button>
          {statusDescription ? (
            <span id={descriptionId} className="sr-only">
              {statusDescription}
            </span>
          ) : null}
          <ActionTooltip
            label={t("sidebar.archiveChatNamed", { title: chat.title })}
            shortcut={archiveShortcut}
            side="right"
          >
            <button
              type="button"
              className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-100 outline-none transition-[color,background-color,opacity] hover:bg-background/80 hover:text-muted-foreground focus-visible:bg-background/80 focus-visible:text-muted-foreground md:opacity-0 md:group-hover/chat:opacity-100 md:group-focus-within/chat:opacity-100"
              aria-label={t("sidebar.archiveChatNamed", { title: chat.title })}
              onClick={() => onArchive(chat.id)}
            >
              <Archive className="size-3.5" />
            </button>
          </ActionTooltip>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-52"
        data-testid="chat-context-menu"
        aria-label={t("sidebar.chatActionsNamed", { title: chat.title })}
      >
        <ContextMenuItem onSelect={() => onMarkUnread(chat.id)}>
          <Mail />
          {t("sidebar.markUnread")}
          <ContextMenuShortcut>R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onSetPinned(chat.id, !chat.isPinned)}>
          {chat.isPinned ? <PinOff /> : <Pin />}
          {t(chat.isPinned ? "sidebar.unpin" : "sidebar.pin")}
          <ContextMenuShortcut>P</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRename(chat.id)}>
          <Pencil />
          {t("sidebar.rename")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onCopyLink(chat.id)}>
          <Link2 />
          {t("sidebar.copyLink")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem data-testid="archive-chat" onSelect={() => onArchive(chat.id)}>
          <Archive />
          {t("sidebar.archiveChat")}
          <ContextMenuShortcut>{archiveShortcut}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
