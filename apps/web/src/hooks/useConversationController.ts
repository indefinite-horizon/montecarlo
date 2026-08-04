/** Combines durable Convex conversations with bounded optimistic rendering. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type BranchAnchor,
  type ChatBranch,
  type ChatMessage,
  type ProviderId,
  visibleMessages,
} from "@/lib/conversation";
import type { MessageItem } from "@/lib/convexDomainApi";
import { demoBranches, demoChats, demoProjects } from "@/lib/demoConversation";
import { defaultProviderModels } from "@/lib/providerConfig";
import { streamRuntimeChat } from "@/lib/runtimeClient";
import { buildRuntimeContext } from "@/lib/runtimeContext";
import { useConvexConversationData } from "./useConvexConversationData";

const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

type SessionBranch = {
  chatId: string;
  persisted: boolean;
  branch: ChatBranch;
};

function branchTitle(anchor: BranchAnchor): string {
  const value = anchor.prompt || anchor.selectedText || "New branch";
  return value.length > 38 ? `${value.slice(0, 37).trim()}…` : value;
}

function contextSnapshot(messages: readonly ChatMessage[], sourceMessageId?: string): string[] {
  const recent = messages.slice(-16).map((message) => message.id);
  if (!sourceMessageId || recent.includes(sourceMessageId)) return recent;
  return [...recent.slice(-15), sourceMessageId];
}

function appendToBranch(
  branches: ChatBranch[],
  branchId: string,
  messages: ChatMessage[],
): ChatBranch[] {
  return branches.map((branch) =>
    branch.id === branchId ? { ...branch, messages: [...branch.messages, ...messages] } : branch,
  );
}

function updateBranchMessage(
  branches: ChatBranch[],
  branchId: string,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatBranch[] {
  return branches.map((branch) =>
    branch.id === branchId
      ? {
          ...branch,
          messages: branch.messages.map((message) =>
            message.id === messageId ? update(message) : message,
          ),
        }
      : branch,
  );
}

export function useConversationController(
  runtimeOfflineMessage: string,
  persistenceErrorMessage: string,
  hydrateAllBranches = false,
) {
  const [fallbackBranches, setFallbackBranches] = useState<ChatBranch[]>(demoBranches);
  const [demoActiveChatId, setDemoActiveChatId] = useState(demoChats[0]?.id ?? "");
  const [requestedBranchId, setRequestedBranchId] = useState("branch-root");
  const [sessionBranches, setSessionBranches] = useState<SessionBranch[]>([]);
  const [sessionMessages, setSessionMessages] = useState<Record<string, ChatMessage[]>>({});
  const [pendingBranchTurn, setPendingBranchTurn] = useState<{
    branchId: string;
    prompt: string;
  }>();
  const [provider, setProvider] = useState<ProviderId>("codex");
  const [providerModels, setProviderModels] = useState<Record<ProviderId, string>>({
    ...defaultProviderModels,
  });
  const domain = useConvexConversationData(requestedBranchId, hydrateAllBranches);
  const abortRef = useRef<AbortController>();
  const startedBranchTurnsRef = useRef(new Set<string>());
  const messagePersistenceRef = useRef(new Map<string, Promise<MessageItem | null>>());
  const persistedMessageIdsRef = useRef(new Map<string, string>());
  const durable = !demoMode && domain.hasConversation;
  const loading = !demoMode && domain.loading;
  const activeChatId = durable
    ? String(domain.activeChat?.id)
    : demoMode
      ? demoActiveChatId
      : String(domain.activeChat?.id ?? "");
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
              contextMessageIds: [],
              title: activeDemoChat.title,
              depth: 0,
              createdAt: activeDemoChat.updatedAt,
              messages: [],
            },
          ]
        : [];
    }
    const durableIds = new Set(domain.branches.map((branch) => branch.id));
    const combined = [
      ...domain.branches,
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
        messages: [...persisted, ...session.filter((message) => sessionById.has(message.id))],
      };
    });
  }, [
    activeChatId,
    activeSessionBranches,
    domain.branches,
    durable,
    fallbackBranches,
    sessionMessages,
  ]);
  const activeBranchId =
    branches.find((branch) => branch.id === requestedBranchId)?.id ??
    domain.activeBranchId ??
    branches[0]?.id ??
    "branch-root";
  const messages = useMemo(
    () => visibleMessages(branches, activeBranchId),
    [activeBranchId, branches],
  );

  const appendMessages = useCallback(
    (branchId: string, additions: ChatMessage[]) => {
      if (!durable) {
        if (demoMode) {
          setFallbackBranches((current) => appendToBranch(current, branchId, additions));
        }
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

  const addSessionBranch = useCallback(
    (
      anchor: BranchAnchor,
      parent: ChatBranch,
      id: string,
      persisted: boolean,
      depth?: number,
      contextMessageIds?: string[],
    ) => {
      const createdAt = Date.now();
      const next: ChatBranch = {
        id,
        parentBranchId: parent.id,
        contextMessageIds: contextMessageIds ?? contextSnapshot(messages, anchor.sourceMessageId),
        title: branchTitle(anchor),
        depth: depth ?? parent.depth + 1,
        createdAt,
        anchor,
        messages: [],
      };
      setSessionBranches((current) => [
        ...current.filter((entry) => entry.branch.id !== id),
        { chatId: activeChatId, persisted, branch: next },
      ]);
      setRequestedBranchId(id);
    },
    [activeChatId, messages],
  );

  const createBranch = useCallback(
    async (anchor: BranchAnchor, parentBranchId = activeBranchId) => {
      if (!anchor.prompt.trim() && !anchor.selectedText?.trim()) return false;
      const parent = branches.find((branch) => branch.id === parentBranchId);
      if (!parent) return false;

      if (durable) {
        let sourceMessageId = anchor.sourceMessageId;
        const originalSourceMessageId = sourceMessageId;
        if (
          anchor.selectedText &&
          sourceMessageId &&
          !domain.durableMessageIds.has(sourceMessageId)
        ) {
          const pendingPersistence = messagePersistenceRef.current.get(sourceMessageId);
          if (pendingPersistence) {
            try {
              const persistedMessage = await pendingPersistence;
              if (persistedMessage) {
                persistedMessageIdsRef.current.set(sourceMessageId, String(persistedMessage.id));
              }
            } catch {
              // The persistence error is surfaced by the message send path.
            }
          }
          sourceMessageId = persistedMessageIdsRef.current.get(sourceMessageId) ?? sourceMessageId;
        }
        const persistedAnchor = { ...anchor, sourceMessageId };
        const sourceMessageIsPersisted =
          sourceMessageId !== undefined &&
          (domain.durableMessageIds.has(sourceMessageId) ||
            (originalSourceMessageId !== undefined &&
              persistedMessageIdsRef.current.get(originalSourceMessageId) === sourceMessageId));
        const selectionCanPersist = !persistedAnchor.selectedText || sourceMessageIsPersisted;
        if (!selectionCanPersist) {
          toast.error(persistenceErrorMessage);
          return false;
        }
        try {
          const created = await domain.createBranch(persistedAnchor, parent.id);
          if (!created) return false;
          addSessionBranch(
            persistedAnchor,
            parent,
            String(created.id),
            true,
            created.depth,
            created.contextMessageIds.map(String),
          );
          if (persistedAnchor.prompt.trim()) {
            setPendingBranchTurn({
              branchId: String(created.id),
              prompt: persistedAnchor.prompt.trim(),
            });
          }
          return true;
        } catch {
          toast.error(persistenceErrorMessage);
          return false;
        }
      }

      if (!demoMode) return false;
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const next: ChatBranch = {
        id,
        parentBranchId: parent.id,
        contextMessageIds: contextSnapshot(messages, anchor.sourceMessageId),
        title: branchTitle(anchor),
        depth: parent.depth + 1,
        createdAt,
        anchor,
        messages: [],
      };
      setFallbackBranches((current) => [...current, next]);
      setRequestedBranchId(id);
      if (anchor.prompt.trim()) {
        setPendingBranchTurn({ branchId: id, prompt: anchor.prompt.trim() });
      }
      return true;
    },
    [
      activeBranchId,
      addSessionBranch,
      branches,
      domain,
      durable,
      messages,
      persistenceErrorMessage,
    ],
  );

  const sendMessage = useCallback(
    async (prompt: string) => {
      if (loading || (!durable && !demoMode)) return;
      const text = prompt.trim();
      if (!text) return;
      const branchId = activeBranchId;
      const runtimeMessages = buildRuntimeContext(
        messages,
        branches.find((branch) => branch.id === branchId)?.anchor,
      );
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        branchId,
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      const assistantId = crypto.randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        branchId,
        role: "assistant",
        content: "",
        createdAt: Date.now() + 1,
        provider,
        model: providerModels[provider],
        isStreaming: true,
      };
      appendMessages(branchId, [userMessage, assistantMessage]);

      const persistedSessionBranch = activeSessionBranches.some(
        (entry) => entry.branch.id === branchId && entry.persisted,
      );
      let run = null;
      if (durable && (domain.durableBranchIds.has(branchId) || persistedSessionBranch)) {
        try {
          const inputPersistence = domain.persistMessage({
            branchId,
            clientId: userMessage.id,
            role: "user",
            content: userMessage.content,
          });
          messagePersistenceRef.current.set(userMessage.id, inputPersistence);
          const inputMessage = await inputPersistence;
          messagePersistenceRef.current.delete(userMessage.id);
          if (inputMessage) {
            persistedMessageIdsRef.current.set(userMessage.id, String(inputMessage.id));
            updateMessage(branchId, userMessage.id, (message) => ({
              ...message,
              id: String(inputMessage.id),
            }));
            run = await domain.createRun({
              branchId,
              provider,
              model: providerModels[provider],
              inputMessageId: inputMessage.id,
            });
          }
        } catch {
          messagePersistenceRef.current.delete(userMessage.id);
          toast.error(persistenceErrorMessage);
          setSessionMessages((current) => ({
            ...current,
            [branchId]: (current[branchId] ?? []).filter(
              (message) => message.id !== userMessage.id && message.id !== assistantId,
            ),
          }));
          return;
        }
        if (!run) {
          toast.error(persistenceErrorMessage);
          setSessionMessages((current) => ({
            ...current,
            [branchId]: (current[branchId] ?? []).filter(
              (message) => message.id !== userMessage.id && message.id !== assistantId,
            ),
          }));
          return;
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let outcome: "succeeded" | "failed" | "canceled" = "succeeded";
      let assistantContent = "";
      let persistedAssistantId: string | undefined;
      try {
        await streamRuntimeChat({
          provider,
          model: providerModels[provider],
          messages: runtimeMessages,
          prompt: text,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "error") throw new Error(event.message);
            if (event.type !== "text-delta") return;
            assistantContent += event.delta;
            updateMessage(branchId, assistantId, (message) => ({
              ...message,
              content: `${message.content}${event.delta}`,
            }));
          },
        });
      } catch {
        if (controller.signal.aborted) {
          outcome = "canceled";
        } else {
          outcome = "failed";
          assistantContent = "";
          toast.error(runtimeOfflineMessage);
          setSessionMessages((current) => ({
            ...current,
            [branchId]: (current[branchId] ?? []).filter((message) => message.id !== assistantId),
          }));
        }
      } finally {
        if (run) {
          let outputMessageId: MessageItem["id"] | undefined;
          if (assistantContent.trim()) {
            try {
              const outputPersistence = domain.persistMessage({
                branchId,
                clientId: assistantId,
                role: "assistant",
                content: assistantContent,
                runId: run.id,
              });
              messagePersistenceRef.current.set(assistantId, outputPersistence);
              const outputMessage = await outputPersistence;
              messagePersistenceRef.current.delete(assistantId);
              if (outputMessage) {
                outputMessageId = outputMessage.id;
                persistedAssistantId = String(outputMessage.id);
                persistedMessageIdsRef.current.set(assistantId, String(outputMessage.id));
                updateMessage(branchId, assistantId, (message) => ({
                  ...message,
                  id: String(outputMessage.id),
                }));
              }
            } catch {
              messagePersistenceRef.current.delete(assistantId);
              toast.error(persistenceErrorMessage);
              setSessionMessages((current) => ({
                ...current,
                [branchId]: (current[branchId] ?? []).filter(
                  (message) => message.id !== assistantId,
                ),
              }));
            }
          }
          try {
            await domain.completeRun(run, outcome, outputMessageId);
          } catch {
            toast.error(persistenceErrorMessage);
          }
        }
        updateMessage(branchId, persistedAssistantId ?? assistantId, (message) => ({
          ...message,
          isStreaming: false,
        }));
      }
    },
    [
      activeBranchId,
      activeSessionBranches,
      appendMessages,
      branches,
      domain,
      durable,
      loading,
      messages,
      persistenceErrorMessage,
      provider,
      providerModels,
      runtimeOfflineMessage,
      updateMessage,
    ],
  );

  // lint-allow: no-direct-use-effect — a created branch must render before its first turn targets it.
  useEffect(() => {
    if (loading || !pendingBranchTurn || pendingBranchTurn.branchId !== activeBranchId) return;
    if (startedBranchTurnsRef.current.has(pendingBranchTurn.branchId)) return;
    startedBranchTurnsRef.current.add(pendingBranchTurn.branchId);
    setPendingBranchTurn(undefined);
    void sendMessage(pendingBranchTurn.prompt);
  }, [activeBranchId, loading, pendingBranchTurn, sendMessage]);

  const createWorkspace = useCallback(
    async (input: { name: string; storageMode: "local" | "cloud"; initialChatTitle: string }) => {
      if (loading) return false;
      if (!domain.authenticated) return true;
      try {
        return Boolean(await domain.createWorkspace(input));
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
        return true;
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [domain, persistenceErrorMessage],
  );

  return {
    activeBranchId,
    activeChatId,
    activeChatTitle:
      durable || !demoMode
        ? domain.activeChat?.title
        : demoChats.find((chat) => chat.id === activeChatId)?.title,
    activeProjectName:
      durable || !demoMode
        ? domain.activeProject?.name
        : demoProjects.find(
            (project) =>
              project.id === demoChats.find((chat) => chat.id === activeChatId)?.projectId,
          )?.name,
    branches,
    chats: demoMode ? demoChats : domain.chats,
    createBranch,
    createChat,
    createProject,
    createWorkspace,
    loading,
    messages,
    projects: demoMode ? demoProjects : domain.projects,
    provider,
    model: providerModels[provider],
    selectChat: (chatId: string) => {
      if (demoMode) {
        setDemoActiveChatId(chatId);
        setRequestedBranchId("");
        return;
      }
      domain.selectChat(chatId);
      setRequestedBranchId("");
    },
    sendMessage,
    setActiveBranchId: setRequestedBranchId,
    setProvider,
    setModel: (model: string) => {
      const normalized = model.trim().slice(0, 256);
      if (!normalized) return;
      setProviderModels((current) => ({ ...current, [provider]: normalized }));
    },
    selectWorkspace: (workspaceId: string) => {
      domain.selectWorkspace(workspaceId);
      setRequestedBranchId("");
    },
    stop: () => abortRef.current?.abort(),
    workspaceId: domain.workspace ? String(domain.workspace.id) : undefined,
    workspaceMode: domain.workspace?.storageMode,
    workspaceName: domain.workspace?.name,
    workspaces: domain.workspaces,
  };
}
