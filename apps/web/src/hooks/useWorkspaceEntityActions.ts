/** Owns chat and branch entity actions used by the workspace shell. */

import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { randomFoodChatName } from "@/lib/chatNaming";
import { copyText } from "@/lib/clipboard";
import { branchSubtreeIds } from "@/lib/conversation";
import { archiveSuccessor } from "@/lib/sidebarChats";
import type { useConversationController } from "./useConversationController";
import type { useWorkspaceRouteSync, WorkspaceView } from "./useWorkspaceRouteSync";

type ConversationController = ReturnType<typeof useConversationController>;
type RouteSync = ReturnType<typeof useWorkspaceRouteSync>;

export function useWorkspaceEntityActions({
  controller,
  latestRouteForChat,
  navigateToRoute,
  setSidebarOpen,
  view,
}: {
  controller: ConversationController;
  latestRouteForChat: RouteSync["latestRouteForChat"];
  navigateToRoute: RouteSync["navigateToRoute"];
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  view: WorkspaceView;
}) {
  const { t } = useTranslation();
  const [renameChatId, setRenameChatId] = useState<string>();
  const [renameBranchId, setRenameBranchId] = useState<string>();
  const [deleteBranchId, setDeleteBranchId] = useState<string>();
  const createChatInFlightRef = useRef(false);

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
      if (!chat?.publicId || !chat.rootBranchPublicId) return;
      const workspacePublicId = controller.workspacePublicId;
      const rememberedRoute = workspacePublicId
        ? latestRouteForChat(workspacePublicId, chat.publicId)
        : undefined;
      controller.selectChat(chatId);
      navigateToRoute({
        workspace: workspacePublicId,
        chat: chat.publicId,
        branch: rememberedRoute?.branch ?? chat.rootBranchPublicId,
        view: rememberedRoute?.view ?? view,
      });
      if (window.innerWidth < 768) setSidebarOpen(false);
    },
    [
      controller.chats,
      controller.selectChat,
      controller.workspacePublicId,
      latestRouteForChat,
      navigateToRoute,
      setSidebarOpen,
      view,
    ],
  );

  const archiveChat = useCallback(
    async (chatId: string) => {
      const chat = controller.chats.find((candidate) => candidate.id === chatId);
      if (!chat) return;
      const wasActive = chatId === controller.activeChatId;
      const successor = wasActive
        ? archiveSuccessor(controller.chats, controller.projects, chatId)
        : undefined;
      const hasRoutableSuccessor = Boolean(successor?.publicId && successor.rootBranchPublicId);
      const result = await controller.archiveChat(chatId, randomFoodChatName());
      if (!result) return;
      if (wasActive) {
        navigateToRoute(
          {
            workspace: controller.workspacePublicId,
            chat: hasRoutableSuccessor ? successor?.publicId : result.nextChatPublicId,
            branch: hasRoutableSuccessor
              ? successor?.rootBranchPublicId
              : result.nextRootBranchPublicId,
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
      controller.projects,
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

  const copyBranchLink = useCallback(
    async (branchId: string) => {
      const branch = controller.branches.find((candidate) => candidate.id === branchId);
      if (!controller.workspacePublicId || !controller.activeChatPublicId || !branch?.publicId) {
        toast.error(t("branch.copyLinkError"));
        return;
      }
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({
        workspace: controller.workspacePublicId,
        chat: controller.activeChatPublicId,
        branch: branch.publicId,
        view,
      }).toString();
      url.hash = "";
      try {
        await copyText(url.toString());
        toast.success(t("branch.copyLinkSuccess"));
      } catch {
        toast.error(t("branch.copyLinkError"));
      }
    },
    [controller.activeChatPublicId, controller.branches, controller.workspacePublicId, t, view],
  );

  const renameBranch = controller.branches.find((branch) => branch.id === renameBranchId);
  const deleteBranch = controller.branches.find((branch) => branch.id === deleteBranchId);
  const deleteBranchDescendantCount = deleteBranch
    ? branchSubtreeIds(controller.branches, deleteBranch.id).size - 1
    : 0;
  const submitBranchRename = useCallback(
    async (title: string) => {
      if (!renameBranchId) return false;
      const renamed = await controller.renameBranch(renameBranchId, title);
      if (renamed) {
        setRenameBranchId(undefined);
        toast.success(t("branch.renameSuccess"));
      }
      return renamed;
    },
    [controller.renameBranch, renameBranchId, t],
  );

  const confirmBranchDelete = useCallback(async () => {
    if (!deleteBranchId) return false;
    const deletingActiveBranch = branchSubtreeIds(controller.branches, deleteBranchId).has(
      controller.activeBranchId,
    );
    const deleted = await controller.deleteBranch(deleteBranchId);
    if (!deleted) return false;
    setDeleteBranchId(undefined);
    if (deletingActiveBranch) {
      navigateToRoute({
        workspace: controller.workspacePublicId,
        chat: controller.activeChatPublicId,
        branch: deleted.parentBranchPublicId,
        view,
      });
    }
    toast.success(t("branch.deleteSuccess"));
    return true;
  }, [
    controller.activeBranchId,
    controller.activeChatPublicId,
    controller.branches,
    controller.deleteBranch,
    controller.workspacePublicId,
    deleteBranchId,
    navigateToRoute,
    t,
    view,
  ]);

  return {
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
  };
}
