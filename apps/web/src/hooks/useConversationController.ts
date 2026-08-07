/** Combines durable Convex conversations with bounded optimistic rendering. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { startAutomaticChatTitle } from "@/lib/autoChatTitle";
import {
  type BranchAnchor,
  type ChatBranch,
  type ChatMessage,
  type ProviderId,
  type ReasoningEffort,
  visibleMessages,
} from "@/lib/conversation";
import {
  appendToBranch,
  branchTitle,
  contextSnapshot,
  updateBranchMessage,
} from "@/lib/conversationBranchState";
import type { MessageItem } from "@/lib/convexDomainApi";
import { demoBranches, demoChats, demoProjects, demoWorkspace } from "@/lib/demoConversation";
import { initialProviderModels, saveSelectedProviderModel } from "@/lib/providerConfig";
import { streamRuntimeChat } from "@/lib/runtimeClient";
import { buildRuntimeContext } from "@/lib/runtimeContext";
import { useAutomaticChatTitle } from "./useAutomaticChatTitle";
import { useConvexConversationData } from "./useConvexConversationData";

const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

type SessionBranch = {
  chatId: string;
  persisted: boolean;
  branch: ChatBranch;
};
export function useConversationController(
  runtimeOfflineMessage: string,
  persistenceErrorMessage: string,
  hydrateAllBranches: boolean,
  initialChatTitle: string,
  requestedWorkspacePublicId?: string,
  requestedChatPublicId?: string,
  requestedBranchPublicId?: string,
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
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [fastMode, setFastMode] = useState(false);
  const [providerModels, setProviderModels] =
    useState<Record<ProviderId, string>>(initialProviderModels);
  const setProviderModel = useCallback((targetProvider: ProviderId, model: string) => {
    const normalized = model.trim().slice(0, 256);
    if (!normalized) return;
    saveSelectedProviderModel(targetProvider, normalized);
    setProviderModels((current) => ({ ...current, [targetProvider]: normalized }));
  }, []);
  const domain = useConvexConversationData(
    requestedBranchId,
    hydrateAllBranches,
    initialChatTitle,
    persistenceErrorMessage,
    requestedWorkspacePublicId,
    requestedChatPublicId,
    requestedBranchPublicId,
  );
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
  useAutomaticChatTitle({
    activeChatId,
    enabled: durable && domain.activeChat?.autoTitleReady === true,
    status: domain.activeChat?.autoTitleStatus,
    provider,
    model: providerModels[provider],
    claim: domain.claimAutoTitle,
    complete: domain.completeAutoTitle,
    release: domain.releaseAutoTitle,
  });
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
      publicId: string,
      persisted: boolean,
      depth?: number,
      contextMessageIds?: string[],
    ) => {
      const createdAt = Date.now();
      const next: ChatBranch = {
        id,
        publicId,
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
            created.publicId,
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
          return { id: String(created.id), publicId: created.publicId };
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
        publicId: id,
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
      return { id, publicId: id };
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
      const chatId = activeChatId;
      const runFastMode = provider === "codex" && fastMode;
      const runProvider = provider;
      const runModel = providerModels[provider];
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
        provider: runProvider,
        model: runModel,
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
            const titleClaimToken = crypto.randomUUID();
            void startAutomaticChatTitle({
              claim: () => domain.claimAutoTitle(chatId, titleClaimToken, runProvider, runModel),
              complete: (title) => domain.completeAutoTitle(chatId, titleClaimToken, title),
              release: () => domain.releaseAutoTitle(chatId, titleClaimToken),
            });
            run = await domain.createRun({
              branchId,
              provider: runProvider,
              model: runModel,
              inputMessageId: inputMessage.id,
              reasoningEffort,
              fastMode: runFastMode,
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
          provider: runProvider,
          model: runModel,
          messages: runtimeMessages,
          prompt: text,
          reasoningEffort,
          fastMode: runFastMode,
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
      activeChatId,
      activeSessionBranches,
      appendMessages,
      branches,
      domain,
      durable,
      fastMode,
      loading,
      messages,
      persistenceErrorMessage,
      provider,
      providerModels,
      reasoningEffort,
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
    [domain, persistenceErrorMessage],
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
    [demoActiveChatId, domain.selectWorkspace],
  );

  return {
    activeBranchId,
    activeBranchPublicId:
      branches.find((branch) => branch.id === activeBranchId)?.publicId ??
      (demoMode ? activeBranchId : undefined),
    activeChatId,
    activeChatPublicId:
      domain.activeChat?.publicId ??
      (demoMode
        ? (demoChats.find((chat) => chat.id === activeChatId)?.publicId ?? activeChatId)
        : undefined),
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
    fastMode,
    loading,
    messages,
    projects: demoMode ? demoProjects : domain.projects,
    provider,
    providerModels,
    reasoningEffort,
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
    setFastMode,
    setProvider,
    setProviderModel,
    setReasoningEffort,
    setModel: (model: string) => {
      setProviderModel(provider, model);
    },
    selectWorkspace,
    stop: () => abortRef.current?.abort(),
    workspaceId: demoMode
      ? demoWorkspace.id
      : domain.workspace
        ? String(domain.workspace.id)
        : undefined,
    workspacePublicId: demoMode ? demoWorkspace.publicId : domain.workspace?.publicId,
    workspaceMode: demoMode ? demoWorkspace.storageMode : domain.workspace?.storageMode,
    workspaceName: demoMode ? demoWorkspace.name : domain.workspace?.name,
    workspaces: demoMode ? [demoWorkspace] : domain.workspaces,
  };
}
