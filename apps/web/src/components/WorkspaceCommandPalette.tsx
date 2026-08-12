/** Builds command-palette actions for the active workspace. */

import {
  Archive,
  Boxes,
  Brain,
  FolderPlus,
  GitBranch,
  MessageSquarePlus,
  MessageSquareText,
  PanelLeft,
  PanelRight,
  Settings,
  Sparkles,
  Workflow,
} from "lucide-react";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { useConversationController } from "@/hooks/useConversationController";
import type { WorkspaceView } from "@/hooks/useWorkspaceRouteSync";
import type { ChatBranch } from "@/lib/conversation";
import { CommandPalette, type CommandPaletteAction } from "./CommandPalette";

type WorkspaceCommandPaletteProps = {
  activeBranch?: ChatBranch;
  controller: ReturnType<typeof useConversationController>;
  isStreaming: boolean;
  onArchiveFocusedChat: () => void;
  onCreateChat: () => void;
  onCycleThinking: () => void;
  onOpenBranch: () => void;
  onOpenProjectCreate: () => void;
  onOpenProvider: () => void;
  onOpenSettings: () => void;
  onOpenWorkspaceCreate: () => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  onOpenChange: (open: boolean) => void;
  onSelectChat: (chatId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onViewChange: (view: WorkspaceView) => void;
  open: boolean;
  shortcuts: {
    archiveChat?: string;
    newChat?: string;
    newProject?: string;
    provider?: string;
    thinking?: string;
    toggleLeftSidebar?: string;
    toggleRightSidebar?: string;
  };
  view: WorkspaceView;
};

export const WorkspaceCommandPalette = memo(function WorkspaceCommandPalette({
  activeBranch,
  controller,
  isStreaming,
  onArchiveFocusedChat,
  onCreateChat,
  onCycleThinking,
  onOpenBranch,
  onOpenChange,
  onOpenProjectCreate,
  onOpenProvider,
  onOpenSettings,
  onOpenWorkspaceCreate,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onSelectChat,
  onSelectWorkspace,
  onViewChange,
  open,
  shortcuts,
  view,
}: WorkspaceCommandPaletteProps) {
  const { t } = useTranslation();
  const actions = useMemo<CommandPaletteAction[]>(
    () => [
      {
        id: "toggle-left-sidebar",
        label: t("commandPalette.toggleLeftSidebar"),
        icon: <PanelLeft />,
        shortcut: shortcuts.toggleLeftSidebar,
        onSelect: onToggleLeftSidebar,
      },
      {
        id: "toggle-right-sidebar",
        label: t("commandPalette.toggleRightSidebar"),
        icon: <PanelRight />,
        shortcut: shortcuts.toggleRightSidebar,
        onSelect: onToggleRightSidebar,
      },
      {
        id: "new-chat",
        label: t("sidebar.newChat"),
        icon: <MessageSquarePlus />,
        shortcut: shortcuts.newChat,
        disabled: controller.loading || !controller.workspaceId,
        dataTestId: "command-new-chat",
        onSelect: onCreateChat,
      },
      {
        id: "archive-chat",
        label: t("commandPalette.archiveChat"),
        icon: <Archive />,
        shortcut: shortcuts.archiveChat,
        disabled: controller.loading || !controller.activeChatId,
        dataTestId: "command-archive-chat",
        onSelect: onArchiveFocusedChat,
      },
      {
        id: "select-provider",
        label: t("commandPalette.selectProvider"),
        icon: <Sparkles />,
        shortcut: shortcuts.provider,
        dataTestId: "command-select-provider",
        onSelect: onOpenProvider,
      },
      {
        id: "adjust-thinking",
        label: t("commandPalette.adjustThinking"),
        icon: <Brain />,
        shortcut: shortcuts.thinking,
        dataTestId: "command-adjust-thinking",
        onSelect: onCycleThinking,
      },
      {
        id: "new-project",
        label: t("commandPalette.newProject"),
        icon: <FolderPlus />,
        shortcut: shortcuts.newProject,
        disabled: controller.loading || !controller.workspaceId,
        dataTestId: "command-new-project",
        onSelect: onOpenProjectCreate,
      },
      {
        id: "new-workspace",
        label: t("commandPalette.newWorkspace"),
        icon: <Boxes />,
        dataTestId: "command-new-workspace",
        onSelect: onOpenWorkspaceCreate,
      },
      {
        id: "provider-settings",
        label: t("commandPalette.providerSettings"),
        icon: <Settings />,
        onSelect: onOpenSettings,
      },
      {
        id: "thread-view",
        label: t("commandPalette.threadView"),
        icon: <MessageSquareText />,
        disabled: view === "thread",
        onSelect: () => onViewChange("thread"),
      },
      {
        id: "canvas-view",
        label: t("commandPalette.canvasView"),
        icon: <Workflow />,
        disabled: view === "canvas",
        onSelect: () => onViewChange("canvas"),
      },
      {
        id: "new-branch",
        label: t("commandPalette.newBranch"),
        icon: <GitBranch />,
        disabled: !activeBranch || isStreaming,
        onSelect: () => {
          onViewChange("thread");
          onOpenBranch();
        },
      },
      ...controller.chats
        .filter((chat) => chat.id !== controller.activeChatId)
        .map((chat) => ({
          id: `chat-${chat.id}`,
          label: t("commandPalette.openChat", { title: chat.title }),
          icon: <MessageSquareText />,
          keywords: [chat.title, t("sidebar.newChat")],
          onSelect: () => onSelectChat(chat.id),
        })),
      ...controller.workspaces
        .filter((workspace) => String(workspace.id) !== controller.workspaceId)
        .map((workspace) => ({
          id: `workspace-${workspace.id}`,
          label: t("commandPalette.switchWorkspace", { name: workspace.name }),
          icon: <Boxes />,
          keywords: [workspace.name, t("workspace.switcherLabel")],
          onSelect: () => onSelectWorkspace(String(workspace.id)),
        })),
    ],
    [
      activeBranch,
      controller.activeChatId,
      controller.chats,
      controller.loading,
      controller.workspaceId,
      controller.workspaces,
      isStreaming,
      onArchiveFocusedChat,
      onCreateChat,
      onCycleThinking,
      onOpenBranch,
      onOpenProjectCreate,
      onOpenProvider,
      onOpenSettings,
      onOpenWorkspaceCreate,
      onToggleLeftSidebar,
      onToggleRightSidebar,
      onSelectChat,
      onSelectWorkspace,
      onViewChange,
      shortcuts,
      t,
      view,
    ],
  );

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      actions={actions}
      dialogLabel={t("commandPalette.label")}
      searchPlaceholder={t("commandPalette.placeholder")}
      emptyMessage={t("commandPalette.empty")}
    />
  );
});
