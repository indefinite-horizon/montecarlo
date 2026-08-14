/** Combines durable Convex conversations with bounded optimistic rendering. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { startAutomaticChatTitle } from "@/lib/autoChatTitle";
import {
  type BranchAnchor,
  branchSubtreeIds,
  type ChatBranch,
  type ChatMessage,
  hasRunningBranchInSubtree,
  isBranchRunning,
  type ProviderId,
  type ReasoningEffort,
  visibleMessages,
} from "@/lib/conversation";
import { branchTitle, contextSnapshot, updateBranchTitle } from "@/lib/conversationBranchState";
import type { MessageItem } from "@/lib/convexDomainApi";
import { demoChats, demoProjects, demoWorkspace } from "@/lib/demoConversation";
import { initialProviderModels, saveSelectedProviderModel } from "@/lib/providerConfig";
import { useAutomaticChatTitle } from "./useAutomaticChatTitle";
import { useBranchActivity } from "./useBranchActivity";
import {
  demoMode,
  type PendingBranchTurn,
  useAddSessionBranch,
  useConversationSessionState,
} from "./useConversationSessionState";
import { useConversationTurnRunner } from "./useConversationTurnRunner";
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
  const [pendingBranchTurns, setPendingBranchTurns] = useState<Record<string, PendingBranchTurn>>(
    {},
  );
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
  const branchActivity = useBranchActivity(branches);
  const branchActivityNow = branchActivity.activityNow;
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
      if (isBranchRunning(parent, branchActivityNow)) return false;

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
            const pending = {
              branchId: String(created.id),
              prompt: persistedAnchor.prompt.trim(),
            };
            setPendingBranchTurns((current) => ({ ...current, [pending.branchId]: pending }));
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
        const pending = { branchId: id, prompt: resolvedAnchor.prompt.trim() };
        setPendingBranchTurns((current) => ({ ...current, [pending.branchId]: pending }));
      }
      return { id, publicId: id };
    },
    [
      activeBranchId,
      addSessionBranch,
      branches,
      branchActivityNow,
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

  const sendMessage = useConversationTurnRunner({
    activeBranchId,
    activeChatId,
    activeSessionBranches,
    appendMessages,
    branchActivity,
    branchActivityNow,
    branches,
    domain,
    durable,
    fastMode,
    loading,
    messagePersistenceRef,
    messages,
    persistedMessageIdsRef,
    persistenceErrorMessage,
    provider,
    providerModel: providerModels[provider],
    reasoningEffort,
    removeMessages,
    runtimeOfflineMessage,
    setChatRunning,
    setSessionMessages,
    updateMessage,
  });

  const retryMessage = useCallback(
    async (source: ChatMessage, replacementContent = source.content) => {
      if (loading || hasRunningBranchInSubtree(branches, source.branchId, branchActivityNow)) {
        return false;
      }
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
          const sent = await sendMessage(text, {
            branchId: String(result.branchId),
            contextMessages,
            anchor: sourceBranch.anchor,
          });
          return sent;
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
      return sendMessage(text, {
        branchId: source.branchId,
        contextMessages,
        anchor: sourceBranch.anchor,
      });
    },
    [
      branches,
      branchActivityNow,
      domain,
      durable,
      loading,
      persistenceErrorMessage,
      sendMessage,
      setFallbackBranches,
      setSessionBranches,
      setSessionMessages,
    ],
  );
  const editMessage = retryMessage;

  const renameBranch = useCallback(
    async (branchId: string, title: string) => {
      const branch = branches.find((candidate) => candidate.id === branchId);
      if (!branch?.parentBranchId) return false;
      try {
        if (durable) return await domain.renameBranch(branchId, title);
        if (!demoMode) return false;
        setFallbackBranches((current) => updateBranchTitle(current, branchId, title));
        return true;
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [branches, domain, durable, persistenceErrorMessage, setFallbackBranches],
  );

  const setBranchUnread = useCallback(
    async (branchId: string, unread: boolean) => {
      const branch = branches.find((candidate) => candidate.id === branchId);
      if (!branch) return false;
      try {
        if (durable) return await domain.setBranchUnread(branchId, unread);
        if (!demoMode) return false;
        setFallbackBranches((current) =>
          current.map((candidate) =>
            candidate.id === branchId ? { ...candidate, isUnread: unread } : candidate,
          ),
        );
        return true;
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [branches, domain, durable, persistenceErrorMessage, setFallbackBranches],
  );

  const deleteBranch = useCallback(
    async (branchId: string) => {
      const branch = branches.find((candidate) => candidate.id === branchId);
      if (!branch?.parentBranchId) return false;
      const removedBranchIds = branchSubtreeIds(branches, branchId);
      try {
        if (durable) {
          const result = await domain.deleteBranchSubtree(branchId);
          if (!result) return false;
          setSessionBranches((current) =>
            current.filter((entry) => !removedBranchIds.has(entry.branch.id)),
          );
          setSessionMessages((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([candidateId]) => !removedBranchIds.has(candidateId)),
            ),
          );
          if (removedBranchIds.has(activeBranchId)) {
            setRequestedBranchId(String(result.parentBranchId));
          }
          return {
            parentBranchId: String(result.parentBranchId),
            parentBranchPublicId: result.parentBranchPublicId,
          };
        }
        if (!demoMode) return false;
        setFallbackBranches((current) =>
          current.filter((candidate) => !removedBranchIds.has(candidate.id)),
        );
        if (removedBranchIds.has(activeBranchId)) setRequestedBranchId(branch.parentBranchId);
        return {
          parentBranchId: branch.parentBranchId,
          parentBranchPublicId:
            branches.find((candidate) => candidate.id === branch.parentBranchId)?.publicId ??
            branch.parentBranchId,
        };
      } catch {
        toast.error(persistenceErrorMessage);
        return false;
      }
    },
    [
      activeBranchId,
      branches,
      domain,
      durable,
      persistenceErrorMessage,
      setFallbackBranches,
      setSessionBranches,
      setSessionMessages,
    ],
  );

  // lint-allow: no-direct-use-effect — a created branch must render before its first turn targets it.
  useEffect(() => {
    const pendingBranchTurn = pendingBranchTurns[activeBranchId];
    if (loading || !pendingBranchTurn) return;
    if (startedBranchTurnsRef.current.has(pendingBranchTurn.branchId)) return;
    startedBranchTurnsRef.current.add(pendingBranchTurn.branchId);
    setPendingBranchTurns((current) => {
      if (!(pendingBranchTurn.branchId in current)) return current;
      const next = { ...current };
      delete next[pendingBranchTurn.branchId];
      return next;
    });
    void sendMessage(pendingBranchTurn.prompt);
  }, [activeBranchId, loading, pendingBranchTurns, sendMessage]);

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
    branchActivityNow,
    canStopActiveBranch: branchActivity.isLocallyRunning(activeBranchId),
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
    deleteBranch,
    fastMode,
    loading,
    markChatUnread,
    markChatRead,
    renameBranch,
    setBranchUnread,
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
    stop: () => branchActivity.stop(activeBranchId),
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
