/** Lists projects and chats in the active tenant workspace. */

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Cloud,
  Folder,
  HardDrive,
  PanelLeft,
  Plus,
  Search,
} from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatSummary, ProjectSummary } from "@/lib/conversation";
import { appShortcutLabel } from "@/lib/keyboardShortcuts";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  chats,
  projects,
  activeChatId,
  workspaceId,
  workspaceName,
  workspaceMode,
  workspaces,
  onCreateChat,
  onSelectChat,
  onSelectWorkspace,
  onCreateWorkspace,
  onOpenProjectCreate,
  onOpenCommandPalette,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  open,
  onClose,
}: {
  chats: ChatSummary[];
  projects: ProjectSummary[];
  activeChatId: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceMode?: "local" | "cloud";
  workspaces: Array<{ id: string; name: string; storageMode: "local" | "cloud" }>;
  onCreateChat: (projectId?: string) => void;
  onSelectChat: (chatId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
  onOpenProjectCreate: () => void;
  onOpenCommandPalette: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const newChatShortcut = appShortcutLabel("newChat");
  const commandPaletteShortcut = appShortcutLabel("commandPalette");
  const newProjectShortcut = appShortcutLabel("newProject");
  const looseChats = chats.filter((chat) => !chat.projectId);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-foreground/20 md:hidden"
        onClick={onClose}
        aria-label={t("common.close")}
      />
      <aside
        aria-label={t("sidebar.navigation")}
        className="fixed inset-y-0 left-0 z-50 flex h-screen w-[264px] shrink-0 flex-col border-r border-border bg-background shadow-xl md:relative md:z-auto md:bg-secondary/35 md:shadow-none"
      >
        <div className="flex h-14 items-center gap-1 px-3">
          <ActionTooltip label={t("sidebar.collapse")} side="bottom">
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("sidebar.collapse")}
              onClick={onClose}
            >
              <PanelLeft />
            </Button>
          </ActionTooltip>
          <span className="flex-1" />
          <ActionTooltip label={t("sidebar.back")} side="bottom">
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("sidebar.back")}
              disabled={!canGoBack}
              onClick={onBack}
            >
              <ArrowLeft />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("sidebar.forward")} side="bottom">
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("sidebar.forward")}
              disabled={!canGoForward}
              onClick={onForward}
            >
              <ArrowRight />
            </Button>
          </ActionTooltip>
        </div>

        <div className="px-3 pb-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="workspace-selector"
                className="flex h-10 w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-left text-sm shadow-sm transition-colors hover:bg-accent"
              >
                <span className="grid size-6 place-items-center rounded bg-foreground text-[10px] font-bold text-background">
                  {workspaceInitials(workspaceName)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {workspaceName ?? t("workspace.defaultName")}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
              aria-labelledby="workspace-menu-label"
            >
              <DropdownMenuLabel id="workspace-menu-label" className="sr-only">
                {t("workspace.switcherLabel")}
              </DropdownMenuLabel>
              {workspaces.map((workspace) => {
                const StorageIcon = workspace.storageMode === "local" ? HardDrive : Cloud;
                return (
                  <DropdownMenuItem
                    key={workspace.id}
                    className="gap-2"
                    aria-current={workspace.id === workspaceId ? "true" : undefined}
                    onSelect={() => onSelectWorkspace(workspace.id)}
                  >
                    <StorageIcon className="text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{workspace.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {workspace.storageMode === "local"
                          ? t("workspace.localTitle")
                          : t("workspace.cloudTitle")}
                      </span>
                    </span>
                    {workspace.id === workspaceId ? <Check className="text-primary" /> : null}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onSelect={onCreateWorkspace}>
                <Plus />
                {t("workspace.newWorkspace")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1 px-3 pb-4">
          <Button
            className="group w-full justify-start bg-transparent px-3 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
            variant="ghost"
            aria-label={t("sidebar.newChat")}
            onClick={() => onCreateChat()}
          >
            <Plus />
            <span className="flex-1 text-left">{t("sidebar.create")}</span>
            <span
              aria-hidden="true"
              className="text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              {newChatShortcut}
            </span>
          </Button>
          <Button
            className="group w-full justify-start bg-transparent px-3 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
            variant="ghost"
            aria-label={t("sidebar.searchCommands")}
            onClick={onOpenCommandPalette}
          >
            <Search />
            <span className="flex-1 text-left">{t("sidebar.search")}</span>
            <span className="text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {commandPaletteShortcut}
            </span>
          </Button>
        </div>

        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-5"
          aria-label={t("sidebar.navigation")}
        >
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t("sidebar.projects")}
            </p>
            <ActionTooltip
              label={t("sidebar.newProject")}
              shortcut={newProjectShortcut}
              side="right"
            >
              <Button
                className="size-7"
                size="icon"
                variant="ghost"
                aria-label={t("sidebar.newProject")}
                onClick={onOpenProjectCreate}
              >
                <Plus />
              </Button>
            </ActionTooltip>
          </div>

          <div className="space-y-3">
            {projects.map((project) => (
              <section key={project.id}>
                <div className="group flex h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground/80">
                  <Folder className="size-3.5 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                  <ActionTooltip label={`${t("sidebar.newChat")} — ${project.name}`} side="right">
                    <button
                      type="button"
                      className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 hover:bg-card group-hover:opacity-100 focus:opacity-100"
                      onClick={() => onCreateChat(project.id)}
                      aria-label={`${t("sidebar.newChat")} — ${project.name}`}
                    >
                      <Plus className="size-3" />
                    </button>
                  </ActionTooltip>
                </div>
                <div className="ml-4 border-l border-border pl-1.5">
                  {chats
                    .filter((chat) => chat.projectId === project.id)
                    .map((chat) => (
                      <ChatRow
                        key={chat.id}
                        chat={chat}
                        active={chat.id === activeChatId}
                        onSelect={onSelectChat}
                      />
                    ))}
                </div>
              </section>
            ))}
          </div>

          {looseChats.length ? (
            <section className="mt-5">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {t("sidebar.unfiled")}
              </p>
              {looseChats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={chat.id === activeChatId}
                  onSelect={onSelectChat}
                />
              ))}
            </section>
          ) : null}
        </nav>

        <div className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {workspaceMode === "cloud" ? t("workspace.cloudStatus") : t("workspace.localStatus")}
          </span>
        </div>
      </aside>
    </>
  );
});

function workspaceInitials(name?: string): string {
  const words = name?.trim().split(/\s+/u).filter(Boolean) ?? [];
  if (words.length === 0) return "W";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toLocaleUpperCase();
}

const ChatRow = memo(function ChatRow({
  chat,
  active,
  onSelect,
}: {
  chat: ChatSummary;
  active: boolean;
  onSelect: (chatId: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid="chat-row"
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
        active
          ? "bg-accent font-semibold text-accent-foreground before:absolute before:-left-1.5 before:inset-y-1.5 before:w-0.5 before:rounded-full before:bg-primary"
          : "text-muted-foreground hover:bg-card",
      )}
      onClick={() => onSelect(chat.id)}
      aria-current={active ? "page" : undefined}
    >
      <span className="min-w-0 flex-1 truncate">{chat.title}</span>
      {chat.branchCount > 1 ? (
        <span className="rounded-full border border-border bg-background px-1.5 text-[9px] tabular-nums">
          {chat.branchCount}
        </span>
      ) : null}
    </button>
  );
});
