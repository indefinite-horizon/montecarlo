/** Lists projects and chats in the active tenant workspace. */

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  PanelLeft,
  Plus,
  Search,
} from "lucide-react";
import {
  type CSSProperties,
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ChatSummary, ProjectSummary } from "@/lib/conversation";
import { appShortcutLabel, workspaceShortcutLabel } from "@/lib/keyboardShortcuts";
import { organizeSidebarChats } from "@/lib/sidebarChats";
import { cn } from "@/lib/utils";
import { ActionTooltip } from "./ActionTooltip";
import { SidebarChatRow } from "./SidebarChatRow";
import { SidebarMoreButton } from "./SidebarMoreButton";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const DEFAULT_SIDEBAR_WIDTH = 264;
const MIN_SIDEBAR_WIDTH = 224;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_WIDTH_STORAGE_KEY = "monte-carlo:sidebar-width";
const CHAT_PAGE_SIZE = 5;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function storedSidebarWidth(): number {
  const storedWidth = Number.parseFloat(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "");
  return Number.isFinite(storedWidth) ? clampSidebarWidth(storedWidth) : DEFAULT_SIDEBAR_WIDTH;
}

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  chats,
  projects,
  activeChatId,
  workspaceId,
  workspaceName,
  workspaceMode,
  workspaces,
  onCreateChat,
  onArchiveChat,
  onCopyChatLink,
  onMarkChatUnread,
  onRenameChat,
  onSetChatPinned,
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
  toggleShortcut,
}: {
  chats: ChatSummary[];
  projects: ProjectSummary[];
  activeChatId: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceMode?: "local" | "cloud";
  workspaces: Array<{ id: string; name: string; storageMode: "local" | "cloud" }>;
  onCreateChat: (projectId?: string) => void;
  onArchiveChat: (chatId: string) => void;
  onCopyChatLink: (chatId: string) => void;
  onMarkChatUnread: (chatId: string) => void;
  onRenameChat: (chatId: string) => void;
  onSetChatPinned: (chatId: string, pinned: boolean) => void;
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
  toggleShortcut: string;
}) {
  const { t } = useTranslation();
  const newChatShortcut = appShortcutLabel("newChat");
  const commandPaletteShortcut = appShortcutLabel("commandPalette");
  const newProjectShortcut = appShortcutLabel("newProject");
  const archiveChatShortcut = appShortcutLabel("archiveChat");
  const { pinned, projectless, chatsByProjectId } = organizeSidebarChats(chats, projects);
  const [sidebarWidth, setSidebarWidth] = useState(storedSidebarWidth);
  const [visibleChatCounts, setVisibleChatCounts] = useState<Record<string, number>>({});
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const dragStartRef = useRef<{ clientX: number; width: number } | undefined>(undefined);
  const projectlessChatListId = useId();
  const projectlessSectionKey = `${workspaceId ?? "workspace"}:projectless`;
  const projectlessVisibleCount = visibleChatCounts[projectlessSectionKey] ?? CHAT_PAGE_SIZE;

  const visibleChatCount = (sectionKey: string) => visibleChatCounts[sectionKey] ?? CHAT_PAGE_SIZE;
  const revealMoreChats = (
    sectionKey: string,
    total: number,
    currentlyVisible: number,
    chatListId: string,
  ) => {
    const nextVisible = Math.min(currentlyVisible + CHAT_PAGE_SIZE, total);
    setVisibleChatCounts((current) => ({
      ...current,
      [sectionKey]: Math.max(current[sectionKey] ?? CHAT_PAGE_SIZE, nextVisible),
    }));
    if (nextVisible === total) {
      requestAnimationFrame(() => {
        document
          .getElementById(chatListId)
          ?.querySelectorAll<HTMLButtonElement>('[data-testid="chat-row"] > button:first-child')
          .item(currentlyVisible)
          ?.focus();
      });
    }
  };
  const toggleProject = (projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const updateSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampSidebarWidth(width);
    setSidebarWidth(nextWidth);
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
  }, []);

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLHRElement>) => {
      if (event.button !== 0) return;
      dragStartRef.current = { clientX: event.clientX, width: sidebarWidth };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLHRElement>) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;
      updateSidebarWidth(dragStart.width + event.clientX - dragStart.clientX);
    },
    [updateSidebarWidth],
  );

  const finishResize = useCallback((event: ReactPointerEvent<HTMLHRElement>) => {
    dragStartRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

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
        className="fixed inset-y-0 left-0 z-50 flex h-screen w-[min(264px,calc(100vw-3rem))] shrink-0 flex-col border-r border-border bg-background shadow-xl md:relative md:z-auto md:w-[var(--sidebar-width)] md:bg-secondary/35 md:shadow-none"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <div
          className="electron-titlebar flex h-16 items-center gap-1 px-3"
          data-testid="sidebar-titlebar"
        >
          <ActionTooltip label={t("sidebar.collapse")} shortcut={toggleShortcut} side="bottom">
            <Button
              className="electron-titlebar-leading text-muted-foreground hover:text-muted-foreground"
              size="icon"
              variant="ghost"
              aria-label={t("sidebar.collapse")}
              onClick={onClose}
            >
              <PanelLeft />
            </Button>
          </ActionTooltip>
          <span
            aria-hidden="true"
            className="electron-titlebar-drag flex-1 self-stretch"
            data-testid="sidebar-titlebar-drag-handle"
          />
          <ActionTooltip label={t("sidebar.back")} side="bottom">
            <Button
              className="text-muted-foreground hover:text-muted-foreground"
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
              className="text-muted-foreground hover:text-muted-foreground"
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
              {workspaces.map((workspace, index) => {
                const shortcut = workspaceShortcutLabel(index);
                return (
                  <DropdownMenuItem
                    key={workspace.id}
                    className="gap-2"
                    aria-current={workspace.id === workspaceId ? "true" : undefined}
                    onSelect={() => onSelectWorkspace(workspace.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                    {shortcut ? (
                      <span className="text-xs text-muted-foreground">{shortcut}</span>
                    ) : null}
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
            className="group w-full justify-start bg-transparent px-3 text-sm text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
            variant="ghost"
            aria-label={t("sidebar.newChat")}
            onClick={() => onCreateChat()}
          >
            <Plus className="text-muted-foreground" />
            <span className="flex-1 text-left text-sm" data-testid="sidebar-create-label">
              {t("sidebar.create")}
            </span>
            <span
              aria-hidden="true"
              className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              {newChatShortcut}
            </span>
          </Button>
          <Button
            className="group w-full justify-start bg-transparent px-3 text-sm text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
            variant="ghost"
            aria-label={t("sidebar.searchCommands")}
            onClick={onOpenCommandPalette}
          >
            <Search className="text-muted-foreground" />
            <span className="flex-1 text-left text-sm" data-testid="sidebar-search-label">
              {t("sidebar.search")}
            </span>
            <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {commandPaletteShortcut}
            </span>
          </Button>
        </div>

        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-5"
          aria-label={t("sidebar.navigation")}
        >
          {pinned.length ? (
            <section className="mb-4" data-testid="pinned-chats-section">
              <h2 className="mb-1 px-2 text-xs font-medium text-muted-foreground">
                {t("sidebar.pinned")}
              </h2>
              <div className="space-y-0.5">
                {pinned.map((chat) => (
                  <SidebarChatRow
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeChatId}
                    archiveShortcut={archiveChatShortcut}
                    onArchive={onArchiveChat}
                    onCopyLink={onCopyChatLink}
                    onMarkUnread={onMarkChatUnread}
                    onRename={onRenameChat}
                    onSetPinned={onSetChatPinned}
                    onSelect={onSelectChat}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {projectless.length ? (
            <section className="mb-4" data-testid="projectless-chats">
              <div id={projectlessChatListId} className="space-y-0.5">
                {projectless.slice(0, projectlessVisibleCount).map((chat) => (
                  <SidebarChatRow
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeChatId}
                    archiveShortcut={archiveChatShortcut}
                    onArchive={onArchiveChat}
                    onCopyLink={onCopyChatLink}
                    onMarkUnread={onMarkChatUnread}
                    onRename={onRenameChat}
                    onSetPinned={onSetChatPinned}
                    onSelect={onSelectChat}
                  />
                ))}
              </div>
              {projectless.length > projectlessVisibleCount ? (
                <SidebarMoreButton
                  ariaLabel={t("sidebar.showMoreChats")}
                  controls={projectlessChatListId}
                  onClick={() =>
                    revealMoreChats(
                      projectlessSectionKey,
                      projectless.length,
                      projectlessVisibleCount,
                      projectlessChatListId,
                    )
                  }
                />
              ) : null}
            </section>
          ) : null}

          <div className="mb-1 flex h-8 items-center justify-between pl-2">
            <h2 className="text-xs font-medium text-muted-foreground">{t("sidebar.projects")}</h2>
            <ActionTooltip
              label={t("sidebar.newProject")}
              shortcut={newProjectShortcut}
              side="right"
            >
              <Button
                className="mr-1 size-7 text-muted-foreground hover:text-muted-foreground"
                size="icon"
                variant="ghost"
                aria-label={t("sidebar.newProject")}
                onClick={onOpenProjectCreate}
              >
                <FolderPlus />
              </Button>
            </ActionTooltip>
          </div>

          <div className="mt-1 space-y-1">
            {projects.map((project) => {
              const projectChats = chatsByProjectId.get(project.id) ?? [];
              const sectionKey = `project:${project.id}`;
              const chatListId = `project-chat-list-${project.id}`;
              const projectContentId = `project-content-${project.id}`;
              const collapsed = collapsedProjectIds.has(project.id);
              const visibleCount = visibleChatCount(sectionKey);
              const projectChatCount = chats.filter((chat) => chat.projectId === project.id).length;
              return (
                <section key={project.id} data-testid="project-section">
                  <div className="group flex h-9 items-center gap-1 rounded-lg pl-2 text-sm text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground focus-within:bg-card/70 focus-within:text-foreground">
                    <button
                      type="button"
                      data-testid="project-toggle"
                      className="group/toggle flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none"
                      aria-expanded={!collapsed}
                      aria-controls={projectContentId}
                      onClick={() => toggleProject(project.id)}
                    >
                      <span className="relative size-4 shrink-0">
                        <Folder
                          className="absolute inset-0 size-4 text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-visible/toggle:opacity-0"
                          strokeWidth={1.6}
                        />
                        <ChevronDown
                          className={cn(
                            "absolute left-0.5 top-0.5 size-3 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-visible/toggle:opacity-100",
                            collapsed && "-rotate-90",
                          )}
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="min-w-0 truncate">{project.name}</span>
                        {collapsed ? (
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {projectChatCount}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <ActionTooltip label={`${t("sidebar.newChat")} — ${project.name}`} side="right">
                      <button
                        type="button"
                        className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-muted-foreground"
                        onClick={() => {
                          setCollapsedProjectIds((current) => {
                            if (!current.has(project.id)) return current;
                            const next = new Set(current);
                            next.delete(project.id);
                            return next;
                          });
                          onCreateChat(project.id);
                        }}
                        aria-label={`${t("sidebar.newChat")} — ${project.name}`}
                      >
                        <Plus className="size-4" />
                      </button>
                    </ActionTooltip>
                  </div>
                  <div
                    id={projectContentId}
                    className={cn("space-y-0.5", collapsed && "hidden")}
                    hidden={collapsed}
                  >
                    <div id={chatListId} className="space-y-0.5">
                      {projectChats.slice(0, visibleCount).map((chat) => (
                        <SidebarChatRow
                          key={chat.id}
                          chat={chat}
                          active={chat.id === activeChatId}
                          archiveShortcut={archiveChatShortcut}
                          onArchive={onArchiveChat}
                          onCopyLink={onCopyChatLink}
                          onMarkUnread={onMarkChatUnread}
                          onRename={onRenameChat}
                          onSetPinned={onSetChatPinned}
                          onSelect={onSelectChat}
                        />
                      ))}
                    </div>
                    {projectChats.length > visibleCount ? (
                      <SidebarMoreButton
                        ariaLabel={t("sidebar.showMoreChatsInProject", {
                          project: project.name,
                        })}
                        controls={chatListId}
                        onClick={() =>
                          revealMoreChats(sectionKey, projectChats.length, visibleCount, chatListId)
                        }
                      />
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {workspaceMode === "cloud" ? t("workspace.cloudStatus") : t("workspace.localStatus")}
          </span>
        </div>

        <hr
          aria-label={t("sidebar.resize")}
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          data-testid="sidebar-resize-handle"
          className="absolute inset-y-0 -right-1 hidden h-auto w-2 cursor-col-resize touch-none border-0 outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-primary/60 focus-visible:after:bg-primary md:block"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onDoubleClick={() => updateSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") updateSidebarWidth(sidebarWidth - 8);
            else if (event.key === "ArrowRight") updateSidebarWidth(sidebarWidth + 8);
            else if (event.key === "Home") updateSidebarWidth(MIN_SIDEBAR_WIDTH);
            else if (event.key === "End") updateSidebarWidth(MAX_SIDEBAR_WIDTH);
            else return;
            event.preventDefault();
          }}
        />
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
