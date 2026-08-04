/** Composes the three-pane chat workspace, branching controls, and provider boundary. */

import {
  GitBranch,
  Menu,
  MessageSquareText,
  Moon,
  Network,
  Settings,
  Sun,
  Workflow,
} from "lucide-react";
import { lazy, memo, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConversationController } from "@/hooks/useConversationController";
import { useTheme } from "@/hooks/useTheme";
import type { SelectionAnchor } from "@/lib/conversation";
import { BranchComposer, SelectionBranchAction } from "./BranchComposer";
import { BranchMap } from "./BranchMap";
import { ChatComposer } from "./ChatComposer";
import { ChatTranscript } from "./ChatTranscript";
import { ProviderSettings } from "./ProviderSettings";
import { ProviderSwitcher } from "./ProviderSwitcher";
import { Button } from "./ui/button";
import { WorkspaceSetup } from "./WorkspaceSetup";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const ConversationCanvas = lazy(() =>
  import("./ConversationCanvas").then(({ ConversationCanvas: component }) => ({
    default: component,
  })),
);

type WorkspaceView = "thread" | "canvas";

export const WorkspaceApp = memo(function WorkspaceApp() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<WorkspaceView>("thread");
  const controller = useConversationController(
    t("runtime.offline"),
    t("workspace.persistenceError"),
    view === "canvas",
  );
  const [selection, setSelection] = useState<SelectionAnchor>();
  const [branchComposerOpen, setBranchComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceSetupOpen, setWorkspaceSetupOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [branchMapOpen, setBranchMapOpen] = useState(() => window.innerWidth >= 1280);
  const activeBranch = controller.branches.find(
    (branch) => branch.id === controller.activeBranchId,
  );
  const isStreaming = controller.branches.some((branch) =>
    branch.messages.some((message) => message.isStreaming),
  );

  const openPromptBranch = () => {
    setSelection(undefined);
    setBranchComposerOpen(true);
  };

  const setWorkspaceView = (nextView: WorkspaceView) => {
    setView(nextView);
    setSelection(undefined);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <main
      data-testid="workspace-app"
      className="flex h-screen overflow-hidden bg-background text-foreground"
    >
      <WorkspaceSidebar
        chats={controller.chats}
        projects={controller.projects}
        activeChatId={controller.activeChatId}
        workspaceName={controller.workspaceName}
        workspaceMode={controller.workspaceMode}
        onCreateChat={(projectId) => void controller.createChat(t("chat.initialTitle"), projectId)}
        onCreateProject={controller.createProject}
        onSelectChat={(chatId) => {
          controller.selectChat(chatId);
          if (window.innerWidth < 768) setSidebarOpen(false);
        }}
        onOpenWorkspaceSetup={() => setWorkspaceSetupOpen(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-xl sm:px-5">
          <Button
            className={sidebarOpen ? "md:hidden" : undefined}
            size="icon"
            variant="ghost"
            aria-label={t("sidebar.open")}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </Button>
          <div className="min-w-0 flex-1 sm:min-w-24">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
              <span>{controller.workspaceName ?? t("workspace.defaultName")}</span>
              <span>/</span>
              <span>{controller.activeProjectName ?? t("workspace.projectLabel")}</span>
            </div>
            <h1 className="truncate font-display text-[17px] font-bold tracking-[-0.015em]">
              {activeBranch?.depth === 0 ? controller.activeChatTitle : activeBranch?.title}
            </h1>
          </div>

          <fieldset className="flex items-center rounded-lg border border-border bg-secondary/45 p-0.5">
            <legend className="sr-only">{t("canvas.viewMode")}</legend>
            <Button
              className="h-8 px-2.5"
              size="sm"
              variant={view === "thread" ? "secondary" : "ghost"}
              aria-pressed={view === "thread"}
              aria-label={t("canvas.threadView")}
              onClick={() => setWorkspaceView("thread")}
            >
              <MessageSquareText />
              <span className="hidden lg:inline">{t("canvas.thread")}</span>
            </Button>
            <Button
              className="h-8 px-2.5"
              size="sm"
              variant={view === "canvas" ? "secondary" : "ghost"}
              aria-pressed={view === "canvas"}
              aria-label={t("canvas.canvasView")}
              onClick={() => setWorkspaceView("canvas")}
            >
              <Workflow />
              <span className="hidden lg:inline">{t("canvas.canvas")}</span>
            </Button>
          </fieldset>

          {view === "thread" ? (
            <Button
              className="hidden sm:inline-flex"
              size="sm"
              variant="outline"
              disabled={!activeBranch}
              onClick={openPromptBranch}
            >
              <GitBranch />
              {t("branch.new")}
            </Button>
          ) : null}
          <ProviderSwitcher
            value={controller.provider}
            model={controller.model}
            onChange={controller.setProvider}
            onModelChange={controller.setModel}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          {view === "thread" ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={branchMapOpen ? t("branch.closeMap") : t("branch.mapTitle")}
              aria-expanded={branchMapOpen}
              onClick={() => setBranchMapOpen((current) => !current)}
            >
              <Network />
            </Button>
          ) : null}
          <Button
            className="hidden sm:inline-flex"
            size="icon"
            variant="ghost"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? t("home.lightTheme") : t("home.darkTheme")}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setSettingsOpen(true)}
            aria-label={t("settings.open")}
          >
            <Settings />
          </Button>
        </header>

        {view === "canvas" ? (
          <Suspense
            fallback={
              <div className="grid min-h-0 flex-1 place-items-center" role="status">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("canvas.loading")}
                </span>
              </div>
            }
          >
            <ConversationCanvas
              key={controller.activeChatId}
              branches={controller.branches}
              activeBranchId={controller.activeBranchId}
              loading={controller.loading}
              onSelectBranch={controller.setActiveBranchId}
              onOpenThread={() => setWorkspaceView("thread")}
              onCreateBranch={controller.createBranch}
            />
          </Suspense>
        ) : (
          <>
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              onScroll={() => setSelection(undefined)}
            >
              {activeBranch?.anchor?.selectedText ? (
                <div className="mx-auto mt-6 max-w-3xl px-5 sm:px-8">
                  <div className="rounded-lg border border-primary/20 bg-accent/45 px-4 py-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-primary">
                      {t("branch.following")}
                    </p>
                    <p className="mt-1 line-clamp-2 font-display text-xs italic text-foreground/70">
                      “{activeBranch.anchor.selectedText}”
                    </p>
                  </div>
                </div>
              ) : null}
              <ChatTranscript messages={controller.messages} onSelectText={setSelection} />
            </div>

            <ChatComposer
              disabled={controller.loading || !activeBranch || isStreaming}
              isStreaming={isStreaming}
              onSend={controller.sendMessage}
              onStop={controller.stop}
              onBranch={openPromptBranch}
            />

            {selection && !branchComposerOpen ? (
              <SelectionBranchAction
                selection={selection}
                onOpen={() => setBranchComposerOpen(true)}
              />
            ) : null}

            {branchComposerOpen ? (
              <BranchComposer
                selection={selection}
                onClose={() => {
                  setBranchComposerOpen(false);
                  setSelection(undefined);
                  window.getSelection()?.removeAllRanges();
                }}
                onCreate={controller.createBranch}
              />
            ) : null}
          </>
        )}

        {settingsOpen ? <ProviderSettings onClose={() => setSettingsOpen(false)} /> : null}
        {workspaceSetupOpen ? (
          <WorkspaceSetup
            activeWorkspaceId={controller.workspaceId}
            loading={controller.loading}
            onClose={() => setWorkspaceSetupOpen(false)}
            onCreate={({ name, storageMode }) =>
              controller.createWorkspace({
                name,
                storageMode,
                initialChatTitle: t("chat.initialTitle"),
              })
            }
            onSelect={controller.selectWorkspace}
            workspaces={controller.workspaces.map((workspace) => ({
              id: String(workspace.id),
              name: workspace.name,
              storageMode: workspace.storageMode,
            }))}
          />
        ) : null}
      </section>

      <BranchMap
        branches={controller.branches}
        activeBranchId={controller.activeBranchId}
        onSelect={controller.setActiveBranchId}
        onCreate={openPromptBranch}
        open={view === "thread" && branchMapOpen}
        onClose={() => setBranchMapOpen(false)}
      />
    </main>
  );
});
