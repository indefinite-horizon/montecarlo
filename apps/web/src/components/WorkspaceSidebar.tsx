/** Lists projects and chats in the active tenant workspace. */

import { ChevronDown, Folder, MoreHorizontal, PanelLeftClose, Plus, Search } from "lucide-react";
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
}) {
  const { t } = useTranslation();
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [submittingProject, setSubmittingProject] = useState(false);
  const looseChats = chats.filter((chat) => !chat.projectId);

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

  return (
    <aside className="hidden h-screen w-[264px] shrink-0 flex-col border-r border-border bg-secondary/35 md:flex">
      <div className="flex h-16 items-center justify-between px-4">
        <MonteCarloBrand />
        <Button size="icon" variant="ghost" aria-label={t("sidebar.collapse")}>
          <PanelLeftClose />
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
        <Button size="icon" variant="outline" aria-label={t("sidebar.search")}>
          <Search />
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
                <MoreHorizontal className="size-3.5 opacity-0 group-hover:opacity-100" />
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
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-card",
      )}
      onClick={() => onSelect(chat.id)}
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
