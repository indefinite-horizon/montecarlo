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
import { useSessionPresentationMemory } from "@/hooks/useSessionPresentationMemory";
import { useWorkspaceEntityActions } from "@/hooks/useWorkspaceEntityActions";
import { useWorkspaceRouteSync, type WorkspaceView } from "@/hooks/useWorkspaceRouteSync";
import { useWorkspaceShortcuts } from "@/hooks/useWorkspaceShortcuts";
import { randomFoodChatName } from "@/lib/chatNaming";
import {
  isBranchRunning,
  isThreadOpeningContentReady,
  nextReasoningEffort,
  type SelectionAnchor,
} from "@/lib/conversation";
import { appShortcutLabel } from "@/lib/keyboardShortcuts";
import { BranchComposer, SelectionBranchAction } from "./BranchComposer";
import { BranchDeleteDialog } from "./BranchDeleteDialog";
import { BranchMap } from "./BranchMap";
import { BranchRenameDialog } from "./BranchRenameDialog";
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
  const { navigateToRoute, latestRouteForChat, goBack, goForward, canGoBack, canGoForward } =
    useWorkspaceRouteSync({
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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [modelEditorOpen, setModelEditorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [branchMapOpen, setBranchMapOpen] = useState(() => window.innerWidth >= 1280);
  const workspaceIds = useMemo(
    () => controller.workspaces.map((workspace) => String(workspace.id)),
    [controller.workspaces],
  );
  const sidebarOverlaysWorkspace = useMediaQuery("(max-width: 767px)");
  const branchMapOverlaysWorkspace = useMediaQuery("(max-width: 1279px)");
  const activeBranch = controller.branches.find(
    (branch) => branch.id === controller.activeBranchId,
  );
  const activeBranchRunning = isBranchRunning(activeBranch, controller.branchActivityNow);
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
    setBranchMapOpen((current) => !current);
  }, []);

  const {
    archiveChat,
    archiveFocusedChat,
    confirmBranchDelete,
    copyBranchLink,
    copyChatLink,
    createNewChat,
    deleteBranch,
    deleteBranchDescendantCount,
    markChatUnread,
    renameBranch,
    renameChat,
    selectChat,
    setChatPinned,
    setDeleteBranchId,
    setRenameBranchId,
    setRenameChatId,
    submitBranchRename,
    submitChatRename,
  } = useWorkspaceEntityActions({
    controller,
    latestRouteForChat,
    navigateToRoute,
    setSidebarOpen,
    view,
  });

  const markLatestMessageRead = useCallback(
    async (messagePublicId: string) => {
      const marked = await controller.markChatRead(controller.activeChatId, messagePublicId);
      if (marked && activeBranch?.isUnread) {
        await controller.setBranchUnread(activeBranch.id, false);
      }
      return marked;
    },
    [activeBranch, controller.activeChatId, controller.markChatRead, controller.setBranchUnread],
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
      const rememberedRoute = latestRouteForChat(selected.workspacePublicId, selected.chatPublicId);
      navigateToRoute(
        rememberedRoute ?? {
          workspace: selected.workspacePublicId,
          chat: selected.chatPublicId,
          branch: selected.branchPublicId,
          view,
        },
      );
    },
    [controller.selectWorkspace, controller.workspaces, latestRouteForChat, navigateToRoute, view],
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
    Boolean(renameBranch) ||
    Boolean(deleteBranch) ||
    modelEditorOpen ||
    branchComposerOpen;
  const workspaceOccluded =
    (sidebarOpen && sidebarOverlaysWorkspace) || (branchMapOpen && branchMapOverlaysWorkspace);
  const readTrackingEnabled =
    !blockingDialogOpen && !commandPaletteOpen && !providerMenuOpen && !workspaceOccluded;
  const presentationWorkspaceId = controller.workspacePublicId;
  const presentationChatId = controller.activeChatPublicId;
  const presentationBranchId = controller.activeBranchPublicId;
  const {
    initialCanvasBranchScrollBookmarks,
    initialCanvasViewport,
    initialThreadScrollBookmark,
    rememberActiveCanvasViewport,
    rememberActiveThreadScroll,
    rememberCanvasBranchScroll,
  } = useSessionPresentationMemory({
    branches: controller.branches,
    branchId: presentationBranchId,
    chatId: presentationChatId,
    view,
    workspaceId: presentationWorkspaceId,
  });

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
              key={presentationChatId ?? controller.activeChatId}
              branches={controller.branches}
              activeBranchId={controller.activeBranchId}
              activityNow={controller.branchActivityNow}
              initialBranchScrollBookmarks={initialCanvasBranchScrollBookmarks}
              initialViewport={initialCanvasViewport}
              loading={controller.loading}
              readMessageId={readMessagePublicId}
              readTrackingEnabled={readTrackingEnabled}
              onReadMessage={markLatestMessageRead}
              onBranchScrollBookmarkChange={rememberCanvasBranchScroll}
              onSelectBranch={selectBranch}
              onOpenThread={() => setWorkspaceView("thread")}
              onViewportChange={rememberActiveCanvasViewport}
              onEditMessage={controller.editMessage}
              onRetryMessage={controller.retryMessage}
              onCreateBranch={createBranch}
            />
          </Suspense>
        ) : (
          <>
            <WorkspaceThread
              activeBranch={activeBranch}
              branches={controller.branches}
              contentReady={transcriptContentReady}
              initialScrollBookmark={initialThreadScrollBookmark}
              messages={controller.messages}
              onEditMessage={controller.editMessage}
              onClearSelection={() => setSelection(undefined)}
              onSelectText={setSelection}
              onReadMessage={markLatestMessageRead}
              onScrollBookmarkChange={rememberActiveThreadScroll}
              onRetryMessage={controller.retryMessage}
              onSelectBranch={selectBranch}
              readMessageId={readMessagePublicId}
              readTrackingEnabled={readTrackingEnabled}
              streaming={transcriptStreaming}
              threadId={`${presentationChatId ?? controller.activeChatId}:${presentationBranchId ?? controller.activeBranchId}`}
            />

            <ChatComposer
              disabled={controller.loading || activeBranchRunning}
              branchDisabled={!activeBranch}
              isStreaming={activeBranchRunning}
              canStop={controller.canStopActiveBranch}
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
        activityNow={controller.branchActivityNow}
        unreadBranchId={activeChat?.isUnread ? latestCompletedMessage?.branchId : undefined}
        onSelect={selectBranch}
        onCreate={openPromptBranch}
        onCopyLink={(branchId) => void copyBranchLink(branchId)}
        onDelete={setDeleteBranchId}
        onRename={(branchId) => {
          const branch = controller.branches.find((candidate) => candidate.id === branchId);
          if (branch?.parentBranchId) setRenameBranchId(branchId);
          else setRenameChatId(controller.activeChatId);
        }}
        onSetUnread={(branchId, unread) => {
          void controller.setBranchUnread(branchId, unread).then((changed) => {
            if (changed)
              toast.success(t(unread ? "branch.markUnreadSuccess" : "branch.markReadSuccess"));
          });
        }}
        open={branchMapOpen}
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
      {renameBranch ? (
        <BranchRenameDialog
          key={renameBranch.id}
          initialTitle={renameBranch.title}
          onOpenChange={(open) => {
            if (!open) setRenameBranchId(undefined);
          }}
          onRename={submitBranchRename}
        />
      ) : null}
      {deleteBranch ? (
        <BranchDeleteDialog
          title={deleteBranch.title}
          descendantCount={deleteBranchDescendantCount}
          onOpenChange={(open) => {
            if (!open) setDeleteBranchId(undefined);
          }}
          onDelete={confirmBranchDelete}
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
        activeBranchRunning={activeBranchRunning}
        controller={controller}
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
