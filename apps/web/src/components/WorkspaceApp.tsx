/** Composes the three-pane chat workspace, branching controls, and provider boundary. */

import { GitBranch, Menu, Moon, Settings, Share2, Sun } from "lucide-react";
import { memo, useState } from "react";
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

export const WorkspaceApp = memo(function WorkspaceApp() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const controller = useConversationController(
    t("runtime.offline"),
    t("workspace.persistenceError"),
  );
  const [selection, setSelection] = useState<SelectionAnchor>();
  const [branchComposerOpen, setBranchComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceSetupOpen, setWorkspaceSetupOpen] = useState(false);
  const activeBranch = controller.branches.find(
    (branch) => branch.id === controller.activeBranchId,
  );
  const isStreaming = controller.messages.some((message) => message.isStreaming);

  const openPromptBranch = () => {
    setSelection(undefined);
    setBranchComposerOpen(true);
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
        onSelectChat={controller.selectChat}
        onOpenWorkspaceSetup={() => setWorkspaceSetupOpen(true)}
      />

      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-xl sm:px-5">
          <Button className="md:hidden" size="icon" variant="ghost" aria-label={t("sidebar.open")}>
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
              <span>{controller.workspaceName ?? t("workspace.defaultName")}</span>
              <span>/</span>
              <span>{controller.activeProjectName ?? t("workspace.projectLabel")}</span>
            </div>
            <h1 className="truncate font-display text-[17px] font-bold tracking-[-0.015em]">
              {activeBranch?.depth === 0 ? controller.activeChatTitle : activeBranch?.title}
            </h1>
          </div>

          <Button
            className="hidden sm:inline-flex"
            size="sm"
            variant="outline"
            onClick={openPromptBranch}
          >
            <GitBranch />
            {t("branch.new")}
          </Button>
          <ProviderSwitcher
            value={controller.provider}
            model={controller.model}
            onChange={controller.setProvider}
            onModelChange={controller.setModel}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <Button size="icon" variant="ghost" aria-label={t("chat.share")}>
            <Share2 />
          </Button>
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

        <div className="min-h-0 flex-1 overflow-y-auto" onScroll={() => setSelection(undefined)}>
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
          disabled={controller.loading}
          isStreaming={isStreaming}
          onSend={controller.sendMessage}
          onStop={controller.stop}
          onBranch={openPromptBranch}
        />

        {selection && !branchComposerOpen ? (
          <SelectionBranchAction selection={selection} onOpen={() => setBranchComposerOpen(true)} />
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

        {settingsOpen ? <ProviderSettings onClose={() => setSettingsOpen(false)} /> : null}
        {workspaceSetupOpen ? (
          <WorkspaceSetup
            activeWorkspaceId={controller.workspaceId}
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
      />
    </main>
  );
});
