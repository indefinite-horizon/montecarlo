/** Provides workspace, project, and chat mutations for the conversation controller. */

import { type Dispatch, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import { demoChats, demoWorkspace } from "@/lib/demoConversation";
import type { useConvexConversationData } from "./useConvexConversationData";

const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

type ConversationDomain = ReturnType<typeof useConvexConversationData>;

type ConversationWorkspaceActionsInput = {
  activeChatId: string;
  demoActiveChatId: string;
  domain: ConversationDomain;
  loading: boolean;
  persistenceErrorMessage: string;
  setRequestedBranchId: Dispatch<SetStateAction<string>>;
};

export function useConversationWorkspaceActions({
  activeChatId,
  demoActiveChatId,
  domain,
  loading,
  persistenceErrorMessage,
  setRequestedBranchId,
}: ConversationWorkspaceActionsInput) {
  const createWorkspace = useCallback(
    async (input: { name: string; initialChatTitle: string }) => {
      if (loading) return false;
      if (!domain.authenticated) return true;
      try {
        const created = await domain.createWorkspace(input);
        if (!created) return false;
        return {
          workspaceId: String(created.workspace.id),
          workspacePublicId: created.workspace.publicId,
          chatId: String(created.chat.id),
          chatPublicId: created.chat.publicId,
          branchPublicId: created.chat.rootBranchPublicId,
        };
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [domain, loading, persistenceErrorMessage],
  );

  const createProject = useCallback(
    async (name: string) => {
      if (!domain.hasWorkspace) return false;
      try {
        return Boolean(await domain.createProject(name));
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [domain, persistenceErrorMessage],
  );

  const createChat = useCallback(
    async (title: string, projectId?: string) => {
      if (!domain.hasWorkspace) return false;
      try {
        const created = await domain.createChat(title, projectId);
        if (!created) return false;
        setRequestedBranchId("");
        return {
          id: String(created.id),
          publicId: created.publicId,
          rootBranchPublicId: created.rootBranchPublicId,
        };
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [domain, persistenceErrorMessage, setRequestedBranchId],
  );

  const archiveChat = useCallback(
    async (chatId: string, replacementTitle: string) => {
      const chat = domain.chats.find((candidate) => candidate.id === chatId);
      if (!chat?.publicId) return false;
      try {
        const result = await domain.archiveChat(chat.publicId, replacementTitle);
        if (!result) return false;
        if (chatId === activeChatId) setRequestedBranchId("");
        return { ...result, archivedChatPublicId: chat.publicId };
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [activeChatId, domain, persistenceErrorMessage, setRequestedBranchId],
  );

  const restoreChat = useCallback(
    async (chatPublicId: string) => {
      try {
        return await domain.restoreChat(chatPublicId);
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [domain, persistenceErrorMessage],
  );

  const renameChat = useCallback(
    async (chatId: string, title: string) => {
      const chat = domain.chats.find((candidate) => candidate.id === chatId);
      if (!chat?.publicId) return false;
      try {
        return await domain.renameChat(chat.publicId, title);
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [domain, persistenceErrorMessage],
  );

  const setChatPinned = useCallback(
    async (chatId: string, pinned: boolean) => {
      const chat = domain.chats.find((candidate) => candidate.id === chatId);
      if (!chat?.publicId) return false;
      try {
        return await domain.setChatPinned(chat.publicId, pinned);
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [domain, persistenceErrorMessage],
  );

  const markChatUnread = useCallback(
    async (chatId: string) => {
      const chat = domain.chats.find((candidate) => candidate.id === chatId);
      if (!chat?.publicId) return false;
      if (chat.isUnread) return true;
      try {
        return await domain.markChatUnread(chat.publicId);
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [domain, persistenceErrorMessage],
  );

  const markChatRead = useCallback(
    async (chatId: string, messagePublicId: string) => {
      const chat = domain.chats.find((candidate) => candidate.id === chatId);
      if (!chat?.publicId || chat.latestCompletedMessagePublicId !== messagePublicId) return false;
      if (!chat.isUnread) return true;
      try {
        return await domain.markChatRead(chat.publicId, messagePublicId);
      } catch {
        return false;
      }
    },
    [domain],
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      if (demoMode) {
        if (workspaceId !== demoWorkspace.id) return null;
        const activeChat = demoChats.find((chat) => chat.id === demoActiveChatId) ?? demoChats[0];
        setRequestedBranchId("");
        return activeChat
          ? {
              workspacePublicId: demoWorkspace.publicId,
              chatPublicId: activeChat.publicId ?? activeChat.id,
              branchPublicId: activeChat.rootBranchPublicId ?? activeChat.id,
            }
          : null;
      }
      const selected = await domain.selectWorkspace(workspaceId);
      setRequestedBranchId("");
      return selected;
    },
    [demoActiveChatId, domain.selectWorkspace, setRequestedBranchId],
  );

  return {
    archiveChat,
    createChat,
    createProject,
    createWorkspace,
    markChatRead,
    markChatUnread,
    renameChat,
    restoreChat,
    selectWorkspace,
    setChatPinned,
  };
}
