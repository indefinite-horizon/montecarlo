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
import { branchTitle, contextSnapshot, updateBranchTitle } from "@/lib/conversationBranchState";
import type { MessageItem } from "@/lib/convexDomainApi";
import { demoChats, demoProjects, demoWorkspace } from "@/lib/demoConversation";
import { initialProviderModels, saveSelectedProviderModel } from "@/lib/providerConfig";
import { streamRuntimeChat } from "@/lib/runtimeClient";
import { buildRuntimeContext } from "@/lib/runtimeContext";
import { useAutomaticChatTitle } from "./useAutomaticChatTitle";
import {
  demoMode,
  type PendingBranchTurn,
  type ReplayContext,
  useAddSessionBranch,
  useConversationSessionState,
} from "./useConversationSessionState";
import { useConversationWorkspaceActions } from "./useConversationWorkspaceActions";
import { useConvexConversationData } from "./useConvexConversationData";
export function useConversationController(
  runtimeOfflineMessage: string,
  persistenceErrorMessage: string,
  hydrateAllBranches: boolean,
  initialChatTitle: string,
  defaultSelectionBranchPrompt: string,
  requestedWorkspacePublicId?: string,
  requestedChatPublicId?: string,
  requestedBranchPublicId?: string,
) {
  const [demoActiveChatId, setDemoActiveChatId] = useState(demoChats[0]?.id ?? "");
  const [requestedBranchId, setRequestedBranchId] = useState("branch-root");
  const [pendingBranchTurn, setPendingBranchTurn] = useState<PendingBranchTurn>();
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
  const abortRef = useRef<AbortController | undefined>(undefined);
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
  const {
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
  } = useConversationSessionState({
    activeChatId,
    domainBranches: domain.branches,
    domainChats: domain.chats,
    durable,
  });
  const activeBranchId =
    branches.find((branch) => branch.id === requestedBranchId)?.id ??
    domain.activeBranchId ??
    branches[0]?.id ??
    "branch-root";
  const messages = useMemo(
    () => visibleMessages(branches, activeBranchId),
    [activeBranchId, branches],
  );
  const addSessionBranch = useAddSessionBranch({
    activeChatId,
    messages,
    setRequestedBranchId,
    setSessionBranches,
  });

  const createBranch = useCallback(
    async (anchor: BranchAnchor, parentBranchId = activeBranchId) => {
      const resolvedAnchor =
        anchor.selectedText?.trim() && !anchor.prompt.trim()
          ? { ...anchor, prompt: defaultSelectionBranchPrompt }
          : anchor;
      if (!resolvedAnchor.prompt.trim() && !resolvedAnchor.selectedText?.trim()) return false;
      const parent = branches.find((branch) => branch.id === parentBranchId);
      if (!parent) return false;

      if (durable) {
        let sourceMessageId = resolvedAnchor.sourceMessageId;
        const originalSourceMessageId = sourceMessageId;
        if (
          resolvedAnchor.selectedText &&
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
        const persistedAnchor = { ...resolvedAnchor, sourceMessageId };
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
          const branchId = String(created.id);
          const branchIntent = branchTitle(persistedAnchor);
          void startAutomaticChatTitle({
            claim: async () => ({
              intent: branchIntent,
              provider,
              model: providerModels[provider],
            }),
            complete: (title) => domain.completeBranchAutoTitle(branchId, title),
            release: async () => true,
          });
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
        contextMessageIds: contextSnapshot(messages, resolvedAnchor.sourceMessageId),
        title: branchTitle(resolvedAnchor),
        depth: parent.depth + 1,
        createdAt,
        anchor: resolvedAnchor,
        messages: [],
      };
      setFallbackBranches((current) => [...current, next]);
      void startAutomaticChatTitle({
        claim: async () => ({
          intent: next.title,
          provider,
          model: providerModels[provider],
        }),
        complete: async (title) => {
          setFallbackBranches((current) => updateBranchTitle(current, id, title));
          return true;
        },
        release: async () => true,
      });
      setRequestedBranchId(id);
      if (resolvedAnchor.prompt.trim()) {
        setPendingBranchTurn({ branchId: id, prompt: resolvedAnchor.prompt.trim() });
      }
      return { id, publicId: id };
    },
    [
      activeBranchId,
      addSessionBranch,
      branches,
      defaultSelectionBranchPrompt,
      domain,
      durable,
      messages,
      persistenceErrorMessage,
      provider,
      providerModels,
      setFallbackBranches,
    ],
  );

  const sendMessage = useCallback(
    async (prompt: string, replay?: ReplayContext) => {
      if (loading || (!durable && !demoMode)) return;
      const text = prompt.trim();
      if (!text) return;
      const branchId = replay?.branchId ?? activeBranchId;
      const chatId = activeChatId;
      const runFastMode = provider === "codex" && fastMode;
      const runProvider = provider;
      const runModel = providerModels[provider];
      const runtimeMessages = buildRuntimeContext(
        replay?.contextMessages ?? messages,
        replay?.anchor ?? branches.find((branch) => branch.id === branchId)?.anchor,
      );
      const userId = crypto.randomUUID();
      const userMessage: ChatMessage = {
        id: userId,
        publicId: `message_${userId}`,
        branchId,
        role: "user",
        content: text,
        contentReady: true,
        createdAt: Date.now(),
      };
      const assistantId = crypto.randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        publicId: `message_${assistantId}`,
        branchId,
        role: "assistant",
        content: "",
        contentReady: true,
        createdAt: Date.now() + 1,
        provider: runProvider,
        model: runModel,
        runStatus: "running",
        isStreaming: true,
      };
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const releaseController = () => {
        if (abortRef.current === controller) abortRef.current = undefined;
      };
      setChatRunning(chatId, assistantId, true);
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
            if (!controller.signal.aborted) {
              run = await domain.createRun({
                branchId,
                provider: runProvider,
                model: runModel,
                inputMessageId: inputMessage.id,
                reasoningEffort,
                fastMode: runFastMode,
              });
            }
          }
        } catch {
          setChatRunning(chatId, assistantId, false);
          releaseController();
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
        if (controller.signal.aborted && !run) {
          setChatRunning(chatId, assistantId, false);
          removeMessages(branchId, [assistantId]);
          releaseController();
          return;
        }
        if (!run) {
          setChatRunning(chatId, assistantId, false);
          releaseController();
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

      let outcome: "succeeded" | "failed" | "canceled" = "succeeded";
      let assistantContent = "";
      let persistedAssistantId: string | undefined;
      let receivedFinish = false;
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
            if (event.type === "finish") {
              receivedFinish = true;
              if (event.finishReason === "cancelled" || event.finishReason === "canceled") {
                outcome = "canceled";
              } else if (event.finishReason === "error") {
                outcome = "failed";
              }
              return;
            }
            if (event.type !== "text-delta") return;
            assistantContent += event.delta;
            updateMessage(branchId, assistantId, (message) => ({
              ...message,
              content: `${message.content}${event.delta}`,
            }));
          },
        });
        if (!receivedFinish) throw new Error("Runtime stream ended without a finish event.");
      } catch {
        if (controller.signal.aborted) {
          outcome = "canceled";
        } else {
          outcome = "failed";
          assistantContent = "";
          toast.error(runtimeOfflineMessage);
          removeMessages(branchId, [assistantId]);
        }
      } finally {
        let terminalOutcome = outcome;
        let durableRunCompleted = !run;
        if (run) {
          let outputMessageId: MessageItem["id"] | undefined;
          if (assistantContent.trim()) {
            let outputPersistenceFailed = false;
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
              } else {
                outputPersistenceFailed = true;
              }
            } catch {
              outputPersistenceFailed = true;
              messagePersistenceRef.current.delete(assistantId);
            }
            if (outputPersistenceFailed) {
              terminalOutcome = "failed";
              toast.error(persistenceErrorMessage);
              removeMessages(branchId, [assistantId]);
            }
          }
          try {
            await domain.completeRun(run, terminalOutcome, outputMessageId);
            durableRunCompleted = true;
          } catch {
            try {
              // Completion is idempotent, so retry once in case the response was lost after commit.
              await domain.completeRun(run, terminalOutcome, outputMessageId);
              durableRunCompleted = true;
            } catch {
              try {
                // If the output cannot be attached, terminalize the run without advancing unread.
                await domain.completeRun(run, "failed");
                terminalOutcome = "failed";
                durableRunCompleted = true;
              } catch {
                // Keep the optimistic message and chat busy rather than claiming completion.
              }
              toast.error(persistenceErrorMessage);
            }
          }
        }
        if (!assistantContent.trim()) {
          removeMessages(branchId, [assistantId, persistedAssistantId]);
        } else if (durableRunCompleted) {
          updateMessage(branchId, persistedAssistantId ?? assistantId, (message) => ({
            ...message,
            isStreaming: false,
            runStatus: terminalOutcome,
          }));
        }
        if (durableRunCompleted) setChatRunning(chatId, assistantId, false);
        releaseController();
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
      removeMessages,
      runtimeOfflineMessage,
      setChatRunning,
      setSessionMessages,
      updateMessage,
    ],
  );

  const retryMessage = useCallback(
    async (source: ChatMessage, replacementContent = source.content) => {
      if (loading || messages.some((message) => message.isStreaming)) return false;
      const text = replacementContent.trim();
      if (!text || source.role !== "user") return false;
      const sourceBranch = branches.find((branch) => branch.id === source.branchId);
      if (!sourceBranch) return false;
      const branchMessages = visibleMessages(branches, source.branchId);
      const sourceIndex = branchMessages.findIndex(
        (message) =>
          (source.publicId && message.publicId === source.publicId) || message.id === source.id,
      );
      if (sourceIndex < 0) return false;
      const contextMessages = branchMessages.slice(0, sourceIndex);

      if (durable) {
        if (!source.publicId) return false;
        try {
          const result = await domain.truncateFromUserMessage(source.publicId);
          if (!result) return false;
          const removedMessages = new Set(result.removedMessagePublicIds);
          const removedBranches = new Set(result.removedBranchIds.map(String));
          setSessionMessages((current) =>
            Object.fromEntries(
              Object.entries(current)
                .filter(([branchId]) => !removedBranches.has(branchId))
                .map(([branchId, branchMessages]) => [
                  branchId,
                  branchMessages.filter(
                    (message) => !message.publicId || !removedMessages.has(message.publicId),
                  ),
                ]),
            ),
          );
          setSessionBranches((current) =>
            current.filter((entry) => !removedBranches.has(entry.branch.id)),
          );
          setRequestedBranchId(String(result.branchId));
          await sendMessage(text, {
            branchId: String(result.branchId),
            contextMessages,
            anchor: sourceBranch.anchor,
          });
          return true;
        } catch {
          toast.error(persistenceErrorMessage);
          return false;
        }
      }

      if (!demoMode) return false;
      const removedIds = new Set(
        sourceBranch.messages
          .slice(sourceBranch.messages.findIndex((message) => message.id === source.id))
          .map((message) => message.id),
      );
      setFallbackBranches((current) =>
        current
          .filter(
            (branch) =>
              branch.id === source.branchId ||
              !branch.contextMessageIds?.some((messageId) => removedIds.has(messageId)),
          )
          .map((branch) =>
            branch.id === source.branchId
              ? {
                  ...branch,
                  messages: branch.messages.slice(
                    0,
                    branch.messages.findIndex((message) => message.id === source.id),
                  ),
                }
              : branch,
          ),
      );
      setRequestedBranchId(source.branchId);
      await sendMessage(text, {
        branchId: source.branchId,
        contextMessages,
        anchor: sourceBranch.anchor,
      });
      return true;
    },
    [
      branches,
      domain,
      durable,
      loading,
      messages,
      persistenceErrorMessage,
      sendMessage,
      setFallbackBranches,
      setSessionBranches,
      setSessionMessages,
    ],
  );
  const editMessage = retryMessage;

  // lint-allow: no-direct-use-effect — a created branch must render before its first turn targets it.
  useEffect(() => {
    if (loading || !pendingBranchTurn || pendingBranchTurn.branchId !== activeBranchId) return;
    if (startedBranchTurnsRef.current.has(pendingBranchTurn.branchId)) return;
    startedBranchTurnsRef.current.add(pendingBranchTurn.branchId);
    setPendingBranchTurn(undefined);
    void sendMessage(pendingBranchTurn.prompt);
  }, [activeBranchId, loading, pendingBranchTurn, sendMessage]);

  const {
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
  } = useConversationWorkspaceActions({
    activeChatId,
    demoActiveChatId,
    domain,
    loading,
    persistenceErrorMessage,
    setRequestedBranchId,
  });

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
    archiveChat,
    chats,
    createBranch,
    createChat,
    createProject,
    createWorkspace,
    editMessage,
    fastMode,
    loading,
    markChatUnread,
    markChatRead,
    messages,
    projects: demoMode ? demoProjects : domain.projects,
    provider,
    providerModels,
    reasoningEffort,
    renameChat,
    restoreChat,
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
    retryMessage,
    setActiveBranchId: setRequestedBranchId,
    setFastMode,
    setProvider,
    setProviderModel,
    setReasoningEffort,
    setChatPinned,
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
