/** Composes the three-pane chat workspace, branching controls, and provider boundary. */

import { useSearch } from "@tanstack/react-router";
import { memo, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useClearCollapsedTextSelection } from "@/hooks/useClearCollapsedTextSelection";
import { useConversationController } from "@/hooks/useConversationController";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { useProviderDiscovery } from "@/hooks/useProviderDiscovery";
import { useWorkspaceRouteSync, type WorkspaceView } from "@/hooks/useWorkspaceRouteSync";
import { useWorkspaceShortcuts } from "@/hooks/useWorkspaceShortcuts";
import { randomFoodChatName } from "@/lib/chatNaming";
import {
  isThreadOpeningContentReady,
  nextReasoningEffort,
  type SelectionAnchor,
} from "@/lib/conversation";
import { appShortcutLabel } from "@/lib/keyboardShortcuts";
import { BranchComposer, SelectionBranchAction } from "./BranchComposer";
import { BranchMap } from "./BranchMap";
import { ChatComposer } from "./ChatComposer";
import { ChatRenameDialog } from "./ChatRenameDialog";
import { LazyConversationCanvas } from "./LazyConversationCanvas";
import { ModelEditDialog } from "./ModelEditDialog";
import { ProjectCreateDialog } from "./ProjectCreateDialog";
import { ProviderSettings } from "./ProviderSettings";
import { WorkspaceCommandPalette } from "./WorkspaceCommandPalette";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceSetup } from "./WorkspaceSetup";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { WorkspaceThread } from "./WorkspaceThread";
export const WorkspaceApp = memo(function WorkspaceApp() {
  const { t } = useTranslation();
  const routeSearch = useSearch({ from: "/_authenticated/" });
  const [view, setView] = useState<WorkspaceView>(routeSearch.view);
  const [initialChatTitle] = useState(randomFoodChatName);
  const workspaceSelectionRequestRef = useRef(0);
  const controller = useConversationController(
    t("runtime.offline"),
    t("workspace.persistenceError"),
    view === "canvas",
    initialChatTitle,
    t("branch.defaultPrompt"),
    routeSearch.workspace,
    routeSearch.chat,
    routeSearch.branch,
  );
  const { navigateToRoute, goBack, goForward, canGoBack, canGoForward } = useWorkspaceRouteSync({
    controller,
    routeSearch,
    view,
    setView,
    workspaceSelectionRequestRef,
  });
  const {
    catalogs: modelCatalogs,
    loadingProviders: modelCatalogLoading,
    refreshModels: refreshModelCatalog,
    refreshStatuses: refreshProviderStatuses,
    statuses: providerStatuses,
  } = useProviderDiscovery(controller.setProviderModel);
  const { availableReasoningEfforts, fastModeAvailable } = useModelCapabilities({
    catalogs: modelCatalogs,
    fastMode: controller.fastMode,
    model: controller.model,
    onFastModeChange: controller.setFastMode,
    onReasoningEffortChange: controller.setReasoningEffort,
    provider: controller.provider,
    reasoningEffort: controller.reasoningEffort,
  });
  const [selection, setSelection] = useState<SelectionAnchor>();
  const [branchComposerOpen, setBranchComposerOpen] = useState(false);
  useClearCollapsedTextSelection(setSelection, !branchComposerOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceSetupOpen, setWorkspaceSetupOpen] = useState(false);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [renameChatId, setRenameChatId] = useState<string>();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [modelEditorOpen, setModelEditorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [branchMapOpen, setBranchMapOpen] = useState(() => window.innerWidth >= 1280);
  const workspaceIds = useMemo(
    () => controller.workspaces.map((workspace) => String(workspace.id)),
    [controller.workspaces],
  );
  const createChatInFlightRef = useRef(false);
  const sidebarOverlaysWorkspace = useMediaQuery("(max-width: 767px)");
  const branchMapOverlaysWorkspace = useMediaQuery("(max-width: 1279px)");
  const activeBranch = controller.branches.find(
    (branch) => branch.id === controller.activeBranchId,
  );
  const isStreaming = controller.branches.some((branch) =>
    branch.messages.some((message) => message.isStreaming),
  );
  const transcriptStreaming = controller.messages.some((message) => message.isStreaming);
  const transcriptContentReady =
    !controller.loading && isThreadOpeningContentReady(controller.messages);
  const activeChat = controller.chats.find((chat) => chat.id === controller.activeChatId);
  const latestCompletedMessagePublicId = activeChat?.latestCompletedMessagePublicId;
  const latestCompletedMessage = latestCompletedMessagePublicId
    ? controller.branches
        .flatMap((branch) => branch.messages)
        .find((message) => message.publicId === latestCompletedMessagePublicId)
    : undefined;
  const readMessagePublicId =
    activeChat?.isUnread &&
    latestCompletedMessage &&
    !latestCompletedMessage.isStreaming &&
    latestCompletedMessage.contentReady !== false
      ? latestCompletedMessagePublicId
      : undefined;
  const openPromptBranch = useCallback(() => {
    setSelection(undefined);
    setBranchComposerOpen(true);
  }, []);

  const setWorkspaceView = useCallback(
    (nextView: WorkspaceView) => {
      setView(nextView);
      setSelection(undefined);
      window.getSelection()?.removeAllRanges();
      navigateToRoute({
        workspace: controller.workspacePublicId ?? routeSearch.workspace,
        chat: controller.activeChatPublicId ?? routeSearch.chat,
        branch: controller.activeBranchPublicId ?? routeSearch.branch,
        view: nextView,
      });
    },
    [
      controller.activeBranchPublicId,
      controller.activeChatPublicId,
      controller.workspacePublicId,
      navigateToRoute,
      routeSearch.branch,
      routeSearch.chat,
      routeSearch.workspace,
    ],
  );

  const openProviderSelection = useCallback(() => {
    setWorkspaceView("thread");
    setProviderMenuOpen(true);
    void refreshProviderStatuses();
  }, [refreshProviderStatuses, setWorkspaceView]);

  const openModelSelection = useCallback(() => {
    setModelEditorOpen(true);
    void refreshModelCatalog(controller.provider);
  }, [controller.provider, refreshModelCatalog]);

  const cycleThinkingLevel = useCallback(() => {
    setProviderMenuOpen(false);
    controller.setReasoningEffort(
      nextReasoningEffort(controller.reasoningEffort, availableReasoningEfforts),
    );
  }, [availableReasoningEfforts, controller.reasoningEffort, controller.setReasoningEffort]);

  const toggleLeftSidebar = useCallback(() => {
    setSidebarOpen((current) => !current);
  }, []);

  const toggleRightSidebar = useCallback(() => {
    if (view !== "thread") {
      setBranchMapOpen(true);
      setWorkspaceView("thread");
      return;
    }
    setBranchMapOpen((current) => !current);
  }, [setWorkspaceView, view]);

  const createNewChat = useCallback(
    async (projectId?: string) => {
      if (createChatInFlightRef.current) return false;
      createChatInFlightRef.current = true;
      try {
        const created = await controller.createChat(randomFoodChatName(), projectId);
        if (!created) return false;
        if (typeof created === "object") {
          navigateToRoute({
            workspace: controller.workspacePublicId,
            chat: created.publicId,
            branch: created.rootBranchPublicId,
            view,
          });
        }
        return true;
      } finally {
        createChatInFlightRef.current = false;
      }
    },
    [controller.createChat, controller.workspacePublicId, navigateToRoute, view],
  );

  const selectChat = useCallback(
    (chatId: string) => {
      const chat = controller.chats.find((candidate) => candidate.id === chatId);
      if (!chat) return;
      const chatPublicId = chat.publicId;
      if (!chatPublicId || !chat.rootBranchPublicId) return;
      controller.selectChat(chatId);
      navigateToRoute({
        workspace: controller.workspacePublicId,
        chat: chatPublicId,
        branch: chat.rootBranchPublicId,
        view,
      });
      if (window.innerWidth < 768) setSidebarOpen(false);
    },
    [controller.chats, controller.selectChat, controller.workspacePublicId, navigateToRoute, view],
  );

  const archiveChat = useCallback(
    async (chatId: string) => {
      const chat = controller.chats.find((candidate) => candidate.id === chatId);
      if (!chat) return;
      const wasActive = chatId === controller.activeChatId;
      const result = await controller.archiveChat(chatId, randomFoodChatName());
      if (!result) return;
      if (wasActive) {
        navigateToRoute(
          {
            workspace: controller.workspacePublicId,
            chat: result.nextChatPublicId,
            branch: result.nextRootBranchPublicId,
            view,
          },
          true,
        );
      }
      toast.success(t("sidebar.archiveSuccess", { title: chat.title }), {
        action: {
          label: t("common.undo"),
          onClick: () => void controller.restoreChat(result.archivedChatPublicId),
        },
      });
    },
    [
      controller.activeChatId,
      controller.archiveChat,
      controller.chats,
      controller.restoreChat,
      controller.workspacePublicId,
      navigateToRoute,
      t,
      view,
    ],
  );

  const archiveFocusedChat = useCallback(async () => {
    if (!controller.activeChatId) return;
    await archiveChat(controller.activeChatId);
  }, [archiveChat, controller.activeChatId]);

  const markChatUnread = useCallback(
    async (chatId: string) => {
      const marked = await controller.markChatUnread(chatId);
      if (marked) toast.success(t("sidebar.markUnreadSuccess"));
    },
    [controller.markChatUnread, t],
  );

  const setChatPinned = useCallback(
    async (chatId: string, pinned: boolean) => {
      const changed = await controller.setChatPinned(chatId, pinned);
      if (changed) toast.success(t(pinned ? "sidebar.pinSuccess" : "sidebar.unpinSuccess"));
    },
    [controller.setChatPinned, t],
  );

  const renameChat = controller.chats.find((chat) => chat.id === renameChatId);
  const submitChatRename = useCallback(
    async (title: string) => {
      if (!renameChatId) return false;
      const renamed = await controller.renameChat(renameChatId, title);
      if (renamed) toast.success(t("sidebar.renameSuccess"));
      return renamed;
    },
    [controller.renameChat, renameChatId, t],
  );

  const copyChatLink = useCallback(
    async (chatId: string) => {
      const chat = controller.chats.find((candidate) => candidate.id === chatId);
      if (!controller.workspacePublicId || !chat?.publicId || !chat.rootBranchPublicId) {
        toast.error(t("sidebar.copyLinkError"));
        return;
      }
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({
        workspace: controller.workspacePublicId,
        chat: chat.publicId,
        branch: chat.rootBranchPublicId,
        view,
      }).toString();
      url.hash = "";
      try {
        await navigator.clipboard.writeText(url.toString());
        toast.success(t("sidebar.copyLinkSuccess"));
      } catch {
        toast.error(t("sidebar.copyLinkError"));
      }
    },
    [controller.chats, controller.workspacePublicId, t, view],
  );

  const markLatestMessageRead = useCallback(
    (messagePublicId: string) => controller.markChatRead(controller.activeChatId, messagePublicId),
    [controller.activeChatId, controller.markChatRead],
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      const requestId = workspaceSelectionRequestRef.current + 1;
      workspaceSelectionRequestRef.current = requestId;
      const workspace = controller.workspaces.find(
        (candidate) => String(candidate.id) === workspaceId,
      );
      if (!workspace) return;
      const selected = await controller.selectWorkspace(workspaceId);
      if (!selected || workspaceSelectionRequestRef.current !== requestId) return;
      navigateToRoute({
        workspace: selected.workspacePublicId,
        chat: selected.chatPublicId,
        branch: selected.branchPublicId,
        view,
      });
    },
    [controller.selectWorkspace, controller.workspaces, navigateToRoute, view],
  );

  const selectBranch = useCallback(
    (branchId: string) => {
      const branch = controller.branches.find((candidate) => candidate.id === branchId);
      if (!branch) return;
      const branchPublicId = branch.publicId;
      if (!branchPublicId) return;
      controller.setActiveBranchId(branchId);
      navigateToRoute({
        workspace: controller.workspacePublicId,
        chat: controller.activeChatPublicId,
        branch: branchPublicId,
        view,
      });
    },
    [
      controller.activeChatPublicId,
      controller.branches,
      controller.setActiveBranchId,
      controller.workspacePublicId,
      navigateToRoute,
      view,
    ],
  );

  const createBranch = useCallback(
    async (anchor: Parameters<typeof controller.createBranch>[0], parentBranchId?: string) => {
      const created = await controller.createBranch(anchor, parentBranchId);
      if (!created) return false;
      navigateToRoute({
        workspace: controller.workspacePublicId,
        chat: controller.activeChatPublicId,
        branch: created.publicId,
        view,
      });
      return true;
    },
    [
      controller.activeChatPublicId,
      controller.createBranch,
      controller.workspacePublicId,
      navigateToRoute,
      view,
    ],
  );

  const newChatShortcut = appShortcutLabel("newChat");
  const toggleLeftSidebarShortcut = appShortcutLabel("toggleLeftSidebar");
  const toggleRightSidebarShortcut = appShortcutLabel("toggleRightSidebar");
  const archiveChatShortcut = appShortcutLabel("archiveChat");
  const providerShortcut = appShortcutLabel("providerSelection");
  const thinkingShortcut = appShortcutLabel("thinkingLevel");
  const newProjectShortcut = appShortcutLabel("newProject");
  const blockingDialogOpen =
    settingsOpen ||
    workspaceSetupOpen ||
    projectCreateOpen ||
    Boolean(renameChat) ||
    modelEditorOpen ||
    branchComposerOpen;
  const workspaceOccluded =
    (sidebarOpen && sidebarOverlaysWorkspace) ||
    (view === "thread" && branchMapOpen && branchMapOverlaysWorkspace);
  const readTrackingEnabled =
    !blockingDialogOpen && !commandPaletteOpen && !providerMenuOpen && !workspaceOccluded;

  useWorkspaceShortcuts({
    blockingDialogOpen,
    loading: controller.loading,
    workspaceId: controller.workspaceId,
    workspaceIds,
    selectWorkspace,
    createNewChat,
    archiveFocusedChat,
    openProviderSelection,
    cycleThinkingLevel,
    toggleLeftSidebar,
    toggleRightSidebar,
    setCommandPaletteOpen,
    setProjectCreateOpen,
    setProviderMenuOpen,
  });

  return (
    <main
      data-testid="workspace-app"
      className="flex h-screen overflow-hidden bg-background text-foreground"
    >
      <WorkspaceSidebar
        chats={controller.chats}
        projects={controller.projects}
        activeChatId={controller.activeChatId}
        workspaceId={controller.workspaceId}
        workspaceName={controller.workspaceName}
        workspaceMode={controller.workspaceMode}
        workspaces={controller.workspaces}
        onCreateChat={createNewChat}
        onArchiveChat={(chatId) => void archiveChat(chatId)}
        onCopyChatLink={(chatId) => void copyChatLink(chatId)}
        onMarkChatUnread={(chatId) => void markChatUnread(chatId)}
        onRenameChat={setRenameChatId}
        onSetChatPinned={(chatId, pinned) => void setChatPinned(chatId, pinned)}
        onSelectChat={selectChat}
        onSelectWorkspace={selectWorkspace}
        onCreateWorkspace={() => setWorkspaceSetupOpen(true)}
        onOpenProjectCreate={() => setProjectCreateOpen(true)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={goBack}
        onForward={goForward}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        toggleShortcut={toggleLeftSidebarShortcut}
      />

      <section className="relative flex min-w-0 flex-1 flex-col">
        <WorkspaceHeader
          activeChatTitle={controller.activeChatTitle}
          activeProjectName={controller.activeProjectName}
          branchMapOpen={branchMapOpen}
          branchMapShortcut={toggleRightSidebarShortcut}
          onOpenBranchMap={() => setBranchMapOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSidebar={() => setSidebarOpen(true)}
          sidebarShortcut={toggleLeftSidebarShortcut}
          onViewChange={setWorkspaceView}
          sidebarOpen={sidebarOpen}
          view={view}
        />

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
            <LazyConversationCanvas
              key={controller.activeChatId}
              branches={controller.branches}
              activeBranchId={controller.activeBranchId}
              loading={controller.loading}
              readMessageId={readMessagePublicId}
              readTrackingEnabled={readTrackingEnabled}
              onReadMessage={markLatestMessageRead}
              onSelectBranch={selectBranch}
              onOpenThread={() => setWorkspaceView("thread")}
              onEditMessage={controller.editMessage}
              onRetryMessage={controller.retryMessage}
              onCreateBranch={createBranch}
            />
          </Suspense>
        ) : (
          <>
            <WorkspaceThread
              activeBranch={activeBranch}
              contentReady={transcriptContentReady}
              messages={controller.messages}
              onEditMessage={controller.editMessage}
              onClearSelection={() => setSelection(undefined)}
              onSelectText={setSelection}
              onReadMessage={markLatestMessageRead}
              onRetryMessage={controller.retryMessage}
              readMessageId={readMessagePublicId}
              readTrackingEnabled={readTrackingEnabled}
              streaming={transcriptStreaming}
              threadId={`${controller.activeChatId}:${controller.activeBranchId}`}
            />

            <ChatComposer
              disabled={controller.loading || isStreaming}
              branchDisabled={!activeBranch}
              isStreaming={isStreaming}
              onSend={controller.sendMessage}
              onStop={controller.stop}
              onBranch={openPromptBranch}
              provider={controller.provider}
              model={controller.model}
              providerModels={controller.providerModels}
              reasoningEffort={controller.reasoningEffort}
              reasoningEffortOptions={availableReasoningEfforts}
              fastMode={controller.fastMode}
              fastModeAvailable={fastModeAvailable}
              onProviderChange={controller.setProvider}
              onModelChange={(provider, model) => {
                controller.setProvider(provider);
                controller.setProviderModel(provider, model);
              }}
              onEditModel={openModelSelection}
              onReasoningEffortChange={controller.setReasoningEffort}
              onFastModeChange={controller.setFastMode}
              onOpenProviderSettings={() => setSettingsOpen(true)}
              providerModelCatalogs={modelCatalogs}
              providerModelsLoading={modelCatalogLoading}
              providerStatuses={providerStatuses}
              providerMenuOpen={providerMenuOpen}
              onProviderMenuOpenChange={(open) => {
                setProviderMenuOpen(open);
                if (open) void refreshProviderStatuses();
              }}
              providerShortcut={providerShortcut}
              thinkingShortcut={thinkingShortcut}
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
                onCreate={createBranch}
              />
            ) : null}
          </>
        )}

        {settingsOpen ? (
          <ProviderSettings
            onConnectionChange={() => void refreshProviderStatuses()}
            onClose={() => {
              setSettingsOpen(false);
              void refreshProviderStatuses();
            }}
          />
        ) : null}
        {workspaceSetupOpen ? (
          <WorkspaceSetup
            loading={controller.loading}
            onClose={() => setWorkspaceSetupOpen(false)}
            onCreate={async ({ name }) => {
              const created = await controller.createWorkspace({
                name,
                initialChatTitle: randomFoodChatName(),
              });
              if (!created) return false;
              if (typeof created === "object") {
                navigateToRoute({
                  workspace: created.workspacePublicId,
                  chat: created.chatPublicId,
                  branch: created.branchPublicId,
                  view,
                });
              }
              return true;
            }}
          />
        ) : null}
      </section>

      <BranchMap
        branches={controller.branches}
        activeBranchId={controller.activeBranchId}
        unreadBranchId={activeChat?.isUnread ? latestCompletedMessage?.branchId : undefined}
        onSelect={selectBranch}
        onCreate={openPromptBranch}
        open={view === "thread" && branchMapOpen}
        onClose={() => setBranchMapOpen(false)}
        toggleShortcut={toggleRightSidebarShortcut}
      />
      <ProjectCreateDialog
        open={projectCreateOpen}
        onOpenChange={setProjectCreateOpen}
        onCreate={controller.createProject}
      />
      {renameChat ? (
        <ChatRenameDialog
          key={renameChat.id}
          initialTitle={renameChat.title}
          open
          onOpenChange={(open) => {
            if (!open) setRenameChatId(undefined);
          }}
          onRename={submitChatRename}
        />
      ) : null}
      <ModelEditDialog
        open={modelEditorOpen}
        provider={controller.provider}
        model={controller.model}
        models={modelCatalogs[controller.provider]?.models ?? []}
        loading={modelCatalogLoading[controller.provider] === true}
        onOpenChange={setModelEditorOpen}
        onSave={controller.setModel}
      />
      <WorkspaceCommandPalette
        activeBranch={activeBranch}
        controller={controller}
        isStreaming={isStreaming}
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onArchiveFocusedChat={() => void archiveFocusedChat()}
        onCreateChat={() => void createNewChat()}
        onCycleThinking={cycleThinkingLevel}
        onOpenBranch={openPromptBranch}
        onOpenProjectCreate={() => setProjectCreateOpen(true)}
        onOpenProvider={openProviderSelection}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenWorkspaceCreate={() => setWorkspaceSetupOpen(true)}
        onToggleLeftSidebar={toggleLeftSidebar}
        onToggleRightSidebar={toggleRightSidebar}
        onSelectChat={selectChat}
        onSelectWorkspace={(workspaceId) => void selectWorkspace(workspaceId)}
        onViewChange={setWorkspaceView}
        shortcuts={{
          archiveChat: archiveChatShortcut,
          newChat: newChatShortcut,
          newProject: newProjectShortcut,
          provider: providerShortcut,
          thinking: thinkingShortcut,
          toggleLeftSidebar: toggleLeftSidebarShortcut,
          toggleRightSidebar: toggleRightSidebarShortcut,
        }}
        view={view}
      />
    </main>
  );
});
