/** Adapts authenticated Convex workspace records into browser conversation view models. */

import { useMutation, useQueries, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type BranchAnchor,
  type ChatBranch,
  type ChatSummary,
  isThreadOpeningContentReady,
  type ProviderId,
  type ReasoningEffort,
} from "@/lib/conversation";
import {
  lineageIds,
  messageFromEnvelope,
  projectsFromItems,
  titleForBranch,
} from "@/lib/convexConversationMapping";
import {
  domainApi,
  type MessageItem,
  type MessagePage,
  type RunItem,
  type WorkspaceItem,
} from "@/lib/convexDomainApi";
import {
  encodeMessageEnvelope,
  MESSAGE_ENVELOPE_CONTENT_TYPE,
  putRuntimeBlob,
} from "@/lib/runtimeClient";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { sharedConfig } from "../../../../lib/config";
import { useMessageContentHydration } from "./useMessageContentHydration";

export function useConvexConversationData(
  requestedBranchId: string,
  hydrateAllBranches: boolean,
  initialChatTitle: string,
  persistenceErrorMessage: string,
  requestedWorkspacePublicId?: string,
  requestedChatPublicId?: string,
  requestedBranchPublicId?: string,
) {
  const me = useQuery(api.auth.me);
  const authenticated = me !== undefined && me !== null;
  const workspacePage = useQuery(
    domainApi.workspaces.list,
    authenticated ? { limit: 100 } : "skip",
  );
  const routedWorkspace = useQuery(
    domainApi.workspaces.getByPublicId,
    authenticated && requestedWorkspacePublicId ? { publicId: requestedWorkspacePublicId } : "skip",
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const workspaceItems = useMemo(() => {
    const items = workspacePage?.items ?? [];
    if (!routedWorkspace || items.some((item) => item.id === routedWorkspace.id)) return items;
    return [routedWorkspace, ...items];
  }, [routedWorkspace, workspacePage]);
  const workspace = requestedWorkspacePublicId
    ? routedWorkspace === undefined
      ? undefined
      : (routedWorkspace ??
        workspaceItems.find((item) => String(item.id) === selectedWorkspaceId) ??
        workspaceItems[0])
    : selectedWorkspaceId
      ? workspaceItems.find((item) => String(item.id) === selectedWorkspaceId)
      : workspaceItems[0];
  const projectPage = useQuery(
    domainApi.projects.list,
    workspace ? { workspaceId: workspace.id, limit: 100 } : "skip",
  );
  const chatPage = useQuery(
    domainApi.chats.list,
    workspace ? { workspaceId: workspace.id, limit: 100 } : "skip",
  );
  const routedChatWorkspace = requestedWorkspacePublicId ? routedWorkspace : workspace;
  const routedChat = useQuery(
    domainApi.chats.getByPublicId,
    routedChatWorkspace && requestedChatPublicId
      ? { workspaceId: routedChatWorkspace.id, publicId: requestedChatPublicId }
      : "skip",
  );
  const chatItems = useMemo(() => {
    const items = chatPage?.items ?? [];
    if (!routedChat || items.some((item) => item.id === routedChat.id)) return items;
    return [routedChat, ...items];
  }, [chatPage, routedChat]);
  const chat =
    requestedChatPublicId && routedChatWorkspace
      ? routedChat === undefined
        ? undefined
        : (routedChat ??
          chatItems.find((item) => String(item.id) === selectedChatId) ??
          chatItems[0])
      : selectedChatId
        ? chatItems.find((item) => String(item.id) === selectedChatId)
        : chatItems[0];
  const activeProjectRecord = useQuery(
    domainApi.projects.get,
    workspace && chat?.projectId
      ? { workspaceId: workspace.id, projectId: chat.projectId }
      : "skip",
  );
  const tree = useQuery(
    domainApi.chats.getTree,
    workspace && chat
      ? {
          workspaceId: workspace.id,
          chatId: chat.id,
          limit: 500,
          targetBranchPublicId: hydrateAllBranches ? undefined : requestedBranchPublicId,
        }
      : "skip",
  );

  const activeLineage = useMemo(
    () =>
      tree
        ? lineageIds(tree.branches, requestedBranchId, tree.chat.rootBranchId)
        : ([] as Id<"chat_branches">[]),
    [requestedBranchId, tree],
  );
  const requestedMessageBranchIds = useMemo(
    () => (hydrateAllBranches && tree ? tree.branches.map((branch) => branch.id) : activeLineage),
    [activeLineage, hydrateAllBranches, tree],
  );
  const messageRequests = useMemo(
    () =>
      Object.fromEntries(
        requestedMessageBranchIds.map((branchId) => [
          String(branchId),
          {
            query: domainApi.messages.list,
            args: { workspaceId: workspace?.id as Id<"workspaces">, branchId, limit: 100 },
          },
        ]),
      ),
    [requestedMessageBranchIds, workspace?.id],
  );
  const messageResults = useQueries(messageRequests);
  const messagePagesLoading = requestedMessageBranchIds.some(
    (branchId) => messageResults[String(branchId)] === undefined,
  );
  const messageSummaries = useMemo(
    () =>
      Object.values(messageResults).flatMap((result) =>
        result && !(result instanceof Error) ? (result as MessagePage).items : [],
      ),
    [messageResults],
  );
  const { hydratedContent, isMessageContentReady } = useMessageContentHydration(messageSummaries);

  const projectItems = useMemo(() => {
    const items = projectPage?.items ?? [];
    if (!activeProjectRecord || items.some((item) => item.id === activeProjectRecord.id)) {
      return items;
    }
    return [activeProjectRecord, ...items];
  }, [activeProjectRecord, projectPage]);
  const projects = useMemo(() => projectsFromItems(projectItems), [projectItems]);
  const chats = useMemo<ChatSummary[]>(
    () =>
      chatItems.map((item) => ({
        id: String(item.id),
        publicId: item.publicId,
        rootBranchPublicId: item.rootBranchPublicId,
        projectId: item.projectId ? String(item.projectId) : undefined,
        title: item.title,
        updatedAt: item.updatedAt,
        lastUserMessageAt: item.lastUserMessageAt,
        branchCount: item.id === chat?.id && tree ? tree.branches.length : 1,
        latestCompletedMessagePublicId: item.latestCompletedMessagePublicId,
        isUnread: item.isUnread,
        isPinned: item.isPinned,
        pinnedAt: item.pinnedAt,
        hasOngoingResponse: false,
      })),
    [chat?.id, chatItems, tree],
  );
  const branches = useMemo<ChatBranch[]>(() => {
    if (!tree) return [];
    return tree.branches.map((branch) => {
      const result = messageResults[String(branch.id)];
      const page = result && !(result instanceof Error) ? (result as MessagePage) : undefined;
      const messages =
        page?.items.map((message) =>
          messageFromEnvelope(message, hydratedContent, isMessageContentReady(message)),
        ) ?? [];
      return {
        id: String(branch.id),
        publicId: branch.publicId,
        parentBranchId: branch.parentBranchId ? String(branch.parentBranchId) : undefined,
        contextMessageIds: branch.contextMessageIds.map(String),
        title: titleForBranch(branch, tree.chat.title),
        depth: branch.depth,
        createdAt: branch.createdAt,
        anchor:
          branch.anchorType === "root"
            ? undefined
            : {
                sourceMessageId: branch.anchorSourceMessageId
                  ? String(branch.anchorSourceMessageId)
                  : undefined,
                selectedText: branch.anchorSelection?.quote,
                displayText: branch.anchorSelection?.displayText,
                selectionStart: branch.anchorSelection?.start,
                selectionEnd: branch.anchorSelection?.end,
                prompt: branch.anchorPrompt ?? "",
              },
        messages,
        openingContentReady:
          result !== undefined &&
          (result instanceof Error || isThreadOpeningContentReady(messages)),
      };
    });
  }, [hydratedContent, isMessageContentReady, messageResults, tree]);

  const createWorkspaceMutation = useMutation(domainApi.workspaces.create);
  const createProjectMutation = useMutation(domainApi.projects.create);
  const createChatMutation = useMutation(domainApi.chats.create);
  const archiveChatMutation = useMutation(domainApi.chats.archive);
  const restoreChatMutation = useMutation(domainApi.chats.restore);
  const renameChatMutation = useMutation(domainApi.chats.rename);
  const setChatPinnedMutation = useMutation(domainApi.chats.setPinned);
  const markChatUnreadMutation = useMutation(domainApi.chats.markUnread);
  const markChatReadMutation = useMutation(domainApi.chats.markRead);
  const claimAutoTitleMutation = useMutation(domainApi.chats.claimAutoTitle);
  const releaseAutoTitleMutation = useMutation(domainApi.chats.releaseAutoTitle);
  const completeAutoTitleMutation = useMutation(domainApi.chats.completeAutoTitle);
  const ensureInitialChatMutation = useMutation(domainApi.chats.ensureInitial);
  const createBranchMutation = useMutation(domainApi.branches.create);
  const completeBranchAutoTitleMutation = useMutation(domainApi.branches.completeAutoTitle);
  const reserveBlobMutation = useMutation(domainApi.blobManifests.reserve);
  const markBlobAvailableMutation = useMutation(domainApi.blobManifests.markAvailable);
  const appendMessageMutation = useMutation(domainApi.messages.append);
  const truncateFromUserMessageMutation = useMutation(
    domainApi.messageHistory.truncateFromUserMessage,
  );
  const createRunMutation = useMutation(domainApi.runs.create);
  const completeRunMutation = useMutation(domainApi.runs.complete);
  const bootstrapAttemptsRef = useRef(new Set<string>());
  const bootstrapFailuresRef = useRef(new Map<string, number>());
  const bootstrapRetryTimersRef = useRef(new Map<string, number>());
  const activeWorkspaceIdRef = useRef<string | undefined>(undefined);
  const [bootstrappingWorkspaceId, setBootstrappingWorkspaceId] = useState<string>();
  const [bootstrapRetryNonce, setBootstrapRetryNonce] = useState(0);
  const markReadRequestsRef = useRef(new Map<string, Promise<boolean>>());
  activeWorkspaceIdRef.current = workspace ? String(workspace.id) : undefined;

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      const targetWorkspace = workspaceItems.find((item) => String(item.id) === workspaceId);
      if (!targetWorkspace) return null;
      const targetChat = await ensureInitialChatMutation({
        workspaceId: targetWorkspace.id,
        title: initialChatTitle,
        autoTitle: true,
      });
      setSelectedWorkspaceId(workspaceId);
      setSelectedChatId(String(targetChat.id));
      return {
        workspacePublicId: targetWorkspace.publicId,
        chatPublicId: targetChat.publicId,
        branchPublicId: targetChat.rootBranchPublicId,
      };
    },
    [ensureInitialChatMutation, initialChatTitle, workspaceItems],
  );

  // lint-allow: no-direct-use-effect — clear pending repair retries on unmount.
  useEffect(
    () => () => {
      for (const timer of bootstrapRetryTimersRef.current.values()) window.clearTimeout(timer);
      bootstrapRetryTimersRef.current.clear();
    },
    [],
  );

  // lint-allow: no-direct-use-effect — repair legacy/partial workspaces that have no initial chat.
  useEffect(() => {
    if (!workspace || chatPage === undefined) return;
    const workspaceId = String(workspace.id);
    if ((bootstrapFailuresRef.current.get(workspaceId) ?? 0) > bootstrapRetryNonce) return;
    if (chatPage.items.length > 0) return;
    if (bootstrapAttemptsRef.current.has(workspaceId)) return;
    bootstrapAttemptsRef.current.add(workspaceId);
    setBootstrappingWorkspaceId(workspaceId);
    void ensureInitialChatMutation({
      workspaceId: workspace.id,
      title: initialChatTitle,
      autoTitle: true,
    })
      .then((createdChat) => {
        bootstrapFailuresRef.current.delete(workspaceId);
        const retryTimer = bootstrapRetryTimersRef.current.get(workspaceId);
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        bootstrapRetryTimersRef.current.delete(workspaceId);
        if (activeWorkspaceIdRef.current === workspaceId) {
          setSelectedChatId(String(createdChat.id));
        }
      })
      .catch(() => {
        bootstrapAttemptsRef.current.delete(workspaceId);
        const failures = (bootstrapFailuresRef.current.get(workspaceId) ?? 0) + 1;
        bootstrapFailuresRef.current.set(workspaceId, failures);
        if (
          failures < sharedConfig.workspaceBootstrap.maxAttempts &&
          activeWorkspaceIdRef.current === workspaceId
        ) {
          const timer = window.setTimeout(() => {
            bootstrapRetryTimersRef.current.delete(workspaceId);
            setBootstrapRetryNonce((current) => current + 1);
          }, sharedConfig.workspaceBootstrap.retryDelayMs * failures);
          bootstrapRetryTimersRef.current.set(workspaceId, timer);
        } else if (activeWorkspaceIdRef.current === workspaceId) {
          toast.error(persistenceErrorMessage);
        }
      })
      .finally(() => {
        setBootstrappingWorkspaceId((current) => (current === workspaceId ? undefined : current));
      });
  }, [
    bootstrapRetryNonce,
    chatPage,
    ensureInitialChatMutation,
    initialChatTitle,
    persistenceErrorMessage,
    workspace,
  ]);

  const createWorkspace = useCallback(
    async (input: { name: string; initialChatTitle: string }) => {
      if (!authenticated) return null;
      const createdWorkspace = await createWorkspaceMutation({
        name: input.name,
      });
      const createdChat = await ensureInitialChatMutation({
        workspaceId: createdWorkspace.id,
        title: input.initialChatTitle,
        autoTitle: true,
      });
      setSelectedWorkspaceId(String(createdWorkspace.id));
      setSelectedChatId(String(createdChat.id));
      return { workspace: createdWorkspace, chat: createdChat };
    },
    [authenticated, createWorkspaceMutation, ensureInitialChatMutation],
  );

  const createProject = useCallback(
    async (name: string) => {
      if (!workspace) return null;
      return createProjectMutation({ workspaceId: workspace.id, name });
    },
    [createProjectMutation, workspace],
  );

  const createChat = useCallback(
    async (title: string, projectId?: string) => {
      if (!workspace) return null;
      const created = await createChatMutation({
        workspaceId: workspace.id,
        projectId: projectId ? (projectId as Id<"projects">) : undefined,
        title,
        autoTitle: true,
      });
      setSelectedChatId(String(created.id));
      return created;
    },
    [createChatMutation, workspace],
  );

  const archiveChat = useCallback(
    async (chatPublicId: string, replacementTitle: string) => {
      if (!workspace) return null;
      return archiveChatMutation({
        workspaceId: workspace.id,
        chatPublicId,
        replacementTitle,
      });
    },
    [archiveChatMutation, workspace],
  );

  const restoreChat = useCallback(
    async (chatPublicId: string) => {
      if (!workspace) return false;
      return restoreChatMutation({ workspaceId: workspace.id, chatPublicId });
    },
    [restoreChatMutation, workspace],
  );

  const renameChat = useCallback(
    async (chatPublicId: string, title: string) => {
      if (!workspace) return false;
      return renameChatMutation({ workspaceId: workspace.id, chatPublicId, title });
    },
    [renameChatMutation, workspace],
  );

  const setChatPinned = useCallback(
    async (chatPublicId: string, pinned: boolean) => {
      if (!workspace) return false;
      return setChatPinnedMutation({ workspaceId: workspace.id, chatPublicId, pinned });
    },
    [setChatPinnedMutation, workspace],
  );

  const markChatUnread = useCallback(
    async (chatPublicId: string) => {
      if (!workspace) return false;
      return markChatUnreadMutation({ workspaceId: workspace.id, chatPublicId });
    },
    [markChatUnreadMutation, workspace],
  );

  const markChatRead = useCallback(
    (chatPublicId: string, messagePublicId: string): Promise<boolean> => {
      if (!workspace) return Promise.resolve(false);
      const key = `${workspace.id}:${chatPublicId}:${messagePublicId}`;
      const pending = markReadRequestsRef.current.get(key);
      if (pending) return pending;
      const request = markChatReadMutation({
        workspaceId: workspace.id,
        chatPublicId,
        messagePublicId,
      }).finally(() => {
        markReadRequestsRef.current.delete(key);
      });
      markReadRequestsRef.current.set(key, request);
      return request;
    },
    [markChatReadMutation, workspace],
  );

  const createBranch = useCallback(
    async (anchor: BranchAnchor, parentBranchId: string) => {
      if (!workspace || !chat) return null;
      return createBranchMutation({
        workspaceId: workspace.id,
        chatId: chat.id,
        parentBranchId: parentBranchId as Id<"chat_branches">,
        sourceMessageId: anchor.sourceMessageId
          ? (anchor.sourceMessageId as Id<"messages">)
          : undefined,
        selection:
          anchor.selectedText &&
          anchor.selectionStart !== undefined &&
          anchor.selectionEnd !== undefined
            ? {
                start: anchor.selectionStart,
                end: anchor.selectionEnd,
                quote: anchor.selectedText,
                displayText: anchor.displayText,
              }
            : undefined,
        prompt: anchor.prompt || undefined,
      });
    },
    [chat, createBranchMutation, workspace],
  );

  const completeBranchAutoTitle = useCallback(
    async (branchId: string, title: string) => {
      if (!workspace) return false;
      return completeBranchAutoTitleMutation({
        workspaceId: workspace.id,
        branchId: branchId as Id<"chat_branches">,
        title,
      });
    },
    [completeBranchAutoTitleMutation, workspace],
  );

  const claimAutoTitle = useCallback(
    async (chatId: string, claimToken: string, provider?: ProviderId, model?: string) => {
      if (!workspace) return null;
      return claimAutoTitleMutation({
        workspaceId: workspace.id,
        chatId: chatId as Id<"chats">,
        claimToken,
        provider,
        model,
      });
    },
    [claimAutoTitleMutation, workspace],
  );

  const releaseAutoTitle = useCallback(
    async (chatId: string, claimToken: string) => {
      if (!workspace) return false;
      return releaseAutoTitleMutation({
        workspaceId: workspace.id,
        chatId: chatId as Id<"chats">,
        claimToken,
      });
    },
    [releaseAutoTitleMutation, workspace],
  );

  const completeAutoTitle = useCallback(
    async (chatId: string, claimToken: string, title: string) => {
      if (!workspace) return false;
      return completeAutoTitleMutation({
        workspaceId: workspace.id,
        chatId: chatId as Id<"chats">,
        claimToken,
        title,
      });
    },
    [completeAutoTitleMutation, workspace],
  );

  const persistMessage = useCallback(
    async (input: {
      branchId: string;
      clientId: string;
      role: "system" | "user" | "assistant";
      content: string;
      runId?: Id<"agent_runs">;
      replyToMessageId?: Id<"messages">;
    }): Promise<MessageItem | null> => {
      if (!workspace || !chat) return null;
      const preview = input.content
        .trim()
        .slice(0, sharedConfig.domain.limits.contentPreviewLength);
      if (!preview) return null;
      const envelope = await encodeMessageEnvelope(input.content);
      const reserved = await reserveBlobMutation({
        workspaceId: workspace.id,
        backend: workspace.storageMode === "local" ? "filesystem" : "r2",
        envelopeVersion: 1,
        contentType: MESSAGE_ENVELOPE_CONTENT_TYPE,
        byteLength: envelope.byteLength,
        sha256: envelope.sha256,
      });
      if (reserved.status !== "available") {
        const attestation = await putRuntimeBlob({
          manifestId: String(reserved.id),
          objectKey: reserved.objectKey,
          backend: reserved.backend,
          data: envelope.data,
          byteLength: envelope.byteLength,
          sha256: envelope.sha256,
        });
        const available = await markBlobAvailableMutation({
          workspaceId: workspace.id,
          manifestId: reserved.id,
          attestation,
        });
        if (available.status !== "available") {
          throw new Error("Message content did not become available.");
        }
      }
      return appendMessageMutation({
        workspaceId: workspace.id,
        chatId: chat.id,
        branchId: input.branchId as Id<"chat_branches">,
        publicId: `message_${input.clientId}`,
        role: input.role,
        contentRef: reserved.publicId,
        contentPreview: preview,
        runId: input.runId,
        replyToMessageId: input.replyToMessageId,
      });
    },
    [appendMessageMutation, chat, markBlobAvailableMutation, reserveBlobMutation, workspace],
  );

  const createRun = useCallback(
    async (input: {
      branchId: string;
      provider: ProviderId;
      model: string;
      inputMessageId?: Id<"messages">;
      reasoningEffort: ReasoningEffort;
      fastMode: boolean;
    }): Promise<RunItem | null> => {
      if (!workspace || !chat) return null;
      return createRunMutation({
        workspaceId: workspace.id,
        chatId: chat.id,
        branchId: input.branchId as Id<"chat_branches">,
        inputMessageId: input.inputMessageId,
        runtime: input.provider === "codex" ? "harness" : "model",
        provider: input.provider,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        fastMode: input.fastMode,
      });
    },
    [chat, createRunMutation, workspace],
  );

  const completeRun = useCallback(
    async (
      run: RunItem,
      status: "succeeded" | "failed" | "canceled",
      outputMessageId?: Id<"messages">,
    ) => {
      if (!workspace) return;
      await completeRunMutation({
        workspaceId: workspace.id,
        runId: run.id,
        status,
        outputMessageId,
        ...(status === "failed" ? { errorCode: "runtime_unavailable" } : {}),
      });
    },
    [completeRunMutation, workspace],
  );

  const truncateFromUserMessage = useCallback(
    async (messagePublicId: string) => {
      if (!workspace || !chat) return null;
      return truncateFromUserMessageMutation({
        workspaceId: workspace.id,
        chatId: chat.id,
        messagePublicId,
      });
    },
    [chat, truncateFromUserMessageMutation, workspace],
  );

  const activeBranchId = tree
    ? String(
        tree.branches.some((branch) => String(branch.id) === requestedBranchId)
          ? requestedBranchId
          : tree.chat.rootBranchId,
      )
    : undefined;
  const durableBranchIds = useMemo(
    () => new Set(tree?.branches.map((branch) => String(branch.id)) ?? []),
    [tree],
  );
  const durableMessageIds = useMemo(
    () =>
      new Set(
        Object.values(messageResults).flatMap((result) =>
          result && !(result instanceof Error)
            ? (result as MessagePage).items.map((message) => String(message.id))
            : [],
        ),
      ),
    [messageResults],
  );

  return {
    activeBranchId,
    activeChat: chat,
    activeProject: projectItems.find((project) => project.id === chat?.projectId),
    authenticated,
    archiveChat,
    branches,
    claimAutoTitle,
    completeAutoTitle,
    completeBranchAutoTitle,
    chats,
    completeRun,
    createBranch,
    createChat,
    createProject,
    createRun,
    createWorkspace,
    durableBranchIds,
    durableMessageIds,
    hasConversation: Boolean(workspace && chat && tree),
    hasWorkspace: Boolean(workspace),
    loading:
      me === undefined ||
      (authenticated && workspacePage === undefined) ||
      Boolean(authenticated && requestedWorkspacePublicId && routedWorkspace === undefined) ||
      Boolean(routedChatWorkspace && requestedChatPublicId && routedChat === undefined) ||
      Boolean(workspace && (projectPage === undefined || chatPage === undefined)) ||
      Boolean(workspace && chat?.projectId && activeProjectRecord === undefined) ||
      Boolean(workspace && bootstrappingWorkspaceId === String(workspace.id)) ||
      Boolean(chat && tree === undefined) ||
      messagePagesLoading,
    persistMessage,
    projects,
    markChatUnread,
    markChatRead,
    renameChat,
    releaseAutoTitle,
    restoreChat,
    setChatPinned,
    truncateFromUserMessage,
    selectChat: setSelectedChatId,
    selectWorkspace,
    workspace: workspace as WorkspaceItem | undefined,
    workspaces: workspaceItems,
  };
}
