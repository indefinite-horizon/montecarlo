/** Lists projects and chats in the active tenant workspace. */

import { ChevronDown, Folder, PanelLeftClose, Plus, Search, X } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatSummary, ProjectSummary } from "@/lib/conversation";
import { cn } from "@/lib/utils";
import { MonteCarloBrand } from "./MonteCarloBrand";
import { Button } from "./ui/button";

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  chats,
  projects,
  activeChatId,
  workspaceName,
  workspaceMode,
  onCreateChat,
  onCreateProject,
  onSelectChat,
  onOpenWorkspaceSetup,
  open,
  onClose,
}: {
  chats: ChatSummary[];
  projects: ProjectSummary[];
  activeChatId: string;
  workspaceName?: string;
  workspaceMode?: "local" | "cloud";
  onCreateChat: (projectId?: string) => void;
  onCreateProject: (name: string) => Promise<boolean>;
  onSelectChat: (chatId: string) => void;
  onOpenWorkspaceSetup: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [submittingProject, setSubmittingProject] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleChats = normalizedQuery
    ? chats.filter((chat) => chat.title.toLocaleLowerCase().includes(normalizedQuery))
    : chats;
  const looseChats = visibleChats.filter((chat) => !chat.projectId);

  const submitProject = async () => {
    const name = projectName.trim();
    if (!name || submittingProject) return;
    setSubmittingProject(true);
    try {
      if (await onCreateProject(name)) {
        setProjectName("");
        setCreatingProject(false);
      }
    } finally {
      setSubmittingProject(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-foreground/20 md:hidden"
        onClick={onClose}
        aria-label={t("common.close")}
      />
      <aside className="fixed inset-y-0 left-0 z-50 flex h-screen w-[264px] shrink-0 flex-col border-r border-border bg-background shadow-xl md:relative md:z-auto md:bg-secondary/35 md:shadow-none">
        <div className="flex h-16 items-center justify-between px-4">
          <MonteCarloBrand />
          <Button size="icon" variant="ghost" aria-label={t("sidebar.collapse")} onClick={onClose}>
            <PanelLeftClose className="hidden md:block" />
            <X className="md:hidden" />
          </Button>
        </div>

        <div className="px-3 pb-3">
          <button
            type="button"
            className="flex h-10 w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-left text-sm shadow-sm transition-colors hover:bg-accent"
            onClick={onOpenWorkspaceSetup}
          >
            <span className="grid size-6 place-items-center rounded bg-foreground text-[10px] font-bold text-background">
              RW
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {workspaceName ?? t("workspace.defaultName")}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2 px-3 pb-4">
          <Button className="justify-start" size="sm" onClick={() => onCreateChat()}>
            <Plus />
            {t("sidebar.newChat")}
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label={t("sidebar.search")}
            aria-pressed={searchOpen}
            onClick={() => {
              setSearchOpen((current) => !current);
              if (searchOpen) setQuery("");
            }}
          >
            <Search />
          </Button>
        </div>

        {searchOpen ? (
          <div className="px-3 pb-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-ring"
              placeholder={t("sidebar.search")}
              aria-label={t("sidebar.search")}
            />
          </div>
        ) : null}

        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-5"
          aria-label={t("sidebar.navigation")}
        >
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t("sidebar.projects")}
            </p>
            <Button
              size="xs"
              variant="ghost"
              aria-label={t("sidebar.newProject")}
              onClick={() => setCreatingProject((current) => !current)}
            >
              <Plus />
            </Button>
          </div>

          {creatingProject ? (
            <form
              className="mb-3 flex gap-1.5 px-1"
              onSubmit={(event) => {
                event.preventDefault();
                void submitProject();
              }}
            >
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs outline-none focus:border-ring"
                placeholder={t("sidebar.projectName")}
                aria-label={t("sidebar.projectName")}
              />
              <Button size="xs" disabled={!projectName.trim() || submittingProject}>
                {t("sidebar.createProject")}
              </Button>
            </form>
          ) : null}

          <div className="space-y-3">
            {projects.map((project) => (
              <section key={project.id}>
                <div className="group flex h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground/80">
                  <Folder className="size-3.5 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                  <button
                    type="button"
                    className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 hover:bg-card group-hover:opacity-100 focus:opacity-100"
                    onClick={() => onCreateChat(project.id)}
                    aria-label={`${t("sidebar.newChat")} — ${project.name}`}
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
                <div className="ml-4 border-l border-border pl-1.5">
                  {visibleChats
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
