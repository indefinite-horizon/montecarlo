/** Reconciles durable conversation data with optimistic session state. */

import { type Dispatch, type SetStateAction, useCallback, useMemo, useRef, useState } from "react";
import type { BranchAnchor, ChatBranch, ChatMessage, ChatSummary } from "@/lib/conversation";
import {
  appendToBranch,
  branchTitle,
  contextSnapshot,
  updateBranchMessage,
} from "@/lib/conversationBranchState";
import { demoBranches, demoChats } from "@/lib/demoConversation";

export const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

export type SessionBranch = {
  chatId: string;
  persisted: boolean;
  branch: ChatBranch;
};

export type ReplayContext = {
  branchId: string;
  contextMessages: ChatMessage[];
  anchor?: BranchAnchor;
};

export type PendingBranchTurn = { branchId: string; prompt: string };

type ConversationSessionStateInput = {
  activeChatId: string;
  domainBranches: ChatBranch[];
  domainChats: ChatSummary[];
  durable: boolean;
};

export function useConversationSessionState({
  activeChatId,
  domainBranches,
  domainChats,
  durable,
}: ConversationSessionStateInput) {
  const [fallbackBranches, setFallbackBranches] = useState<ChatBranch[]>(demoBranches);
  const [sessionBranches, setSessionBranches] = useState<SessionBranch[]>([]);
  const [sessionMessages, setSessionMessages] = useState<Record<string, ChatMessage[]>>({});
  const [runningChatIds, setRunningChatIds] = useState<ReadonlySet<string>>(() => new Set());
  const runningChatRequestIdsRef = useRef(new Map<string, Set<string>>());
  const activeSessionBranches = useMemo(
    () => sessionBranches.filter((entry) => entry.chatId === activeChatId),
    [activeChatId, sessionBranches],
  );
  const branches = useMemo(() => {
    if (!durable) {
      if (!demoMode) return [];
      if (activeChatId === demoChats[0]?.id) return fallbackBranches;
      const activeDemoChat = demoChats.find((chat) => chat.id === activeChatId);
      return activeDemoChat
        ? [
            {
              id: `branch-root-${activeDemoChat.id}`,
              publicId: activeDemoChat.rootBranchPublicId,
              contextMessageIds: [],
              title: activeDemoChat.title,
              depth: 0,
              createdAt: activeDemoChat.updatedAt,
              messages: [],
            },
          ]
        : [];
    }
    const durableIds = new Set(domainBranches.map((branch) => branch.id));
    const sessionBranchById = new Map(
      activeSessionBranches.map((entry) => [entry.branch.id, entry.branch]),
    );
    const combined = [
      ...domainBranches,
      ...activeSessionBranches
        .filter((entry) => !durableIds.has(entry.branch.id))
        .map((entry) => entry.branch),
    ];
    return combined.map((branch) => {
      const session = sessionMessages[branch.id] ?? [];
      const sessionById = new Map(session.map((message) => [message.id, message]));
      const persisted = branch.messages.map((message) => {
        const optimistic = sessionById.get(message.id);
        if (!optimistic) return message;
        sessionById.delete(message.id);
        return { ...message, ...optimistic, id: message.id, branchId: message.branchId };
      });
      return {
        ...branch,
        openingContentReady:
          sessionBranchById.get(branch.id)?.openingContentReady ?? branch.openingContentReady,
        messages: [...persisted, ...session.filter((message) => sessionById.has(message.id))],
      };
    });
  }, [
    activeChatId,
    activeSessionBranches,
    domainBranches,
    durable,
    fallbackBranches,
    sessionMessages,
  ]);
  const chats = useMemo(
    () =>
      (demoMode ? demoChats : domainChats).map((chat) => ({
        ...chat,
        hasOngoingResponse: runningChatIds.has(chat.id),
      })),
    [domainChats, runningChatIds],
  );

  const setChatRunning = useCallback((chatId: string, requestId: string, running: boolean) => {
    const requests = new Set(runningChatRequestIdsRef.current.get(chatId) ?? []);
    if (running) requests.add(requestId);
    else requests.delete(requestId);
    if (requests.size > 0) runningChatRequestIdsRef.current.set(chatId, requests);
    else runningChatRequestIdsRef.current.delete(chatId);
    const chatRunning = requests.size > 0;

    setRunningChatIds((current) => {
      if (current.has(chatId) === chatRunning) return current;
      const next = new Set(current);
      if (chatRunning) next.add(chatId);
      else next.delete(chatId);
      return next;
    });
  }, []);

  const appendMessages = useCallback(
    (branchId: string, additions: ChatMessage[]) => {
      if (!durable) {
        if (demoMode)
          setFallbackBranches((current) => appendToBranch(current, branchId, additions));
        return;
      }
      setSessionMessages((current) => ({
        ...current,
        [branchId]: [...(current[branchId] ?? []), ...additions],
      }));
    },
    [durable],
  );

  const updateMessage = useCallback(
    (branchId: string, messageId: string, update: (message: ChatMessage) => ChatMessage) => {
      if (!durable) {
        if (demoMode) {
          setFallbackBranches((current) =>
            updateBranchMessage(current, branchId, messageId, update),
          );
        }
        return;
      }
      setSessionMessages((current) => ({
        ...current,
        [branchId]: (current[branchId] ?? []).map((message) =>
          message.id === messageId ? update(message) : message,
        ),
      }));
    },
    [durable],
  );

  const removeMessages = useCallback(
    (branchId: string, messageIds: Array<string | undefined>) => {
      const removed = new Set(messageIds.filter((id): id is string => Boolean(id)));
      if (!durable) {
        if (demoMode) {
          setFallbackBranches((current) =>
            current.map((branch) =>
              branch.id === branchId
                ? {
                    ...branch,
                    messages: branch.messages.filter((message) => !removed.has(message.id)),
                  }
                : branch,
            ),
          );
        }
        return;
      }
      setSessionMessages((current) => ({
        ...current,
        [branchId]: (current[branchId] ?? []).filter((message) => !removed.has(message.id)),
      }));
    },
    [durable],
  );

  return {
    appendMessages,
    activeSessionBranches,
    branches,
    chats,
    removeMessages,
    setChatRunning,
    setFallbackBranches,
    setSessionBranches,
    setSessionMessages,
    updateMessage,
  };
}

type AddSessionBranchInput = {
  activeChatId: string;
  messages: ChatMessage[];
  setRequestedBranchId: Dispatch<SetStateAction<string>>;
  setSessionBranches: Dispatch<SetStateAction<SessionBranch[]>>;
};

export function useAddSessionBranch({
  activeChatId,
  messages,
  setRequestedBranchId,
  setSessionBranches,
}: AddSessionBranchInput) {
  return useCallback(
    (
      anchor: BranchAnchor,
      parent: ChatBranch,
      id: string,
      publicId: string,
      persisted: boolean,
      depth?: number,
      contextMessageIds?: string[],
    ) => {
      const next: ChatBranch = {
        id,
        publicId,
        parentBranchId: parent.id,
        contextMessageIds: contextMessageIds ?? contextSnapshot(messages, anchor.sourceMessageId),
        title: branchTitle(anchor),
        depth: depth ?? parent.depth + 1,
        createdAt: Date.now(),
        anchor,
        messages: [],
        openingContentReady: true,
      };
      setSessionBranches((current) => [
        ...current.filter((entry) => entry.branch.id !== id),
        { chatId: activeChatId, persisted, branch: next },
      ]);
      setRequestedBranchId(id);
    },
    [activeChatId, messages, setRequestedBranchId, setSessionBranches],
  );
}
