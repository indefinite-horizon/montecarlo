/** Adapts authenticated Convex workspace records into browser conversation view models. */

import { useMutation, useQueries, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  BranchAnchor,
  ChatBranch,
  ChatMessage,
  ChatSummary,
  ProjectSummary,
  ProviderId,
  ReasoningEffort,
} from "@/lib/conversation";
import {
  domainApi,
  type MessageItem,
  type MessagePage,
  type RunItem,
  type WorkspaceItem,
} from "@/lib/convexDomainApi";
import {
  encodeMessageEnvelope,
  getRuntimeMessageContent,
  MESSAGE_ENVELOPE_CONTENT_TYPE,
  putRuntimeBlob,
} from "@/lib/runtimeClient";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { sharedConfig } from "../../../../lib/config";

const PROJECT_COLORS = ["terracotta", "blue", "gold", "green"] as const;
const MAX_HYDRATED_MESSAGES = 256;

function titleForBranch(
  branch: {
    anchorPrompt?: string;
    anchorSelection?: { quote: string };
    contextPreview?: string;
    depth: number;
  },
  chatTitle: string,
): string {
  if (branch.depth === 0) return chatTitle;
  const value = branch.anchorPrompt ?? branch.anchorSelection?.quote ?? branch.contextPreview;
  if (!value) return chatTitle;
  return value.length > 38 ? `${value.slice(0, 37).trim()}…` : value;
}

function lineageIds(
  branches: Array<{ id: Id<"chat_branches">; parentBranchId?: Id<"chat_branches"> }>,
  requestedBranchId: string,
  rootBranchId: Id<"chat_branches">,
): Id<"chat_branches">[] {
  const byId = new Map(branches.map((branch) => [String(branch.id), branch]));
  const requested = byId.get(requestedBranchId) ?? byId.get(String(rootBranchId));
  const lineage: Id<"chat_branches">[] = [];
  const seen = new Set<string>();
  let cursor = requested;

  while (cursor) {
    const id = String(cursor.id);
    if (seen.has(id)) break;
    seen.add(id);
    lineage.unshift(cursor.id);
    cursor = cursor.parentBranchId ? byId.get(String(cursor.parentBranchId)) : undefined;
  }
  return lineage;
}

function hydrationKey(message: MessageItem): string {
  return `${message.objectKey}:${message.sha256}`;
}

function messageFromEnvelope(
  message: MessagePage["items"][number],
  hydratedContent: Record<string, string>,
): ChatMessage {
  return {
    id: String(message.id),
    branchId: String(message.branchId),
    role: message.role === "tool" ? "system" : message.role,
    content: hydratedContent[hydrationKey(message)] ?? message.contentPreview,
    createdAt: message.createdAt,
  };
}

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
          targetBranchPublicId: requestedBranchPublicId,
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
  const [hydratedContent, setHydratedContent] = useState<Record<string, string>>({});
  const hydratedContentRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    const seen = new Set<string>();
    const targets = [...messageSummaries]
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-MAX_HYDRATED_MESSAGES)
      .filter((message) => {
        const key = hydrationKey(message);
        if (seen.has(key) || hydratedContentRef.current[key] !== undefined) return false;
        seen.add(key);
        return true;
      });
    let cursor = 0;

    const hydrateNext = async () => {
      while (!controller.signal.aborted) {
        const message = targets[cursor];
        cursor += 1;
        if (!message) return;
        try {
          const content = await getRuntimeMessageContent({
            objectKey: message.objectKey,
            backend: message.backend,
            envelopeVersion: message.envelopeVersion,
            byteLength: message.byteLength,
            sha256: message.sha256,
            signal: controller.signal,
          });
          if (!controller.signal.aborted) {
            setHydratedContent((current) => {
              const next = { ...current, [hydrationKey(message)]: content };
              const excess = Object.keys(next).length - MAX_HYDRATED_MESSAGES;
              if (excess > 0) {
                for (const key of Object.keys(next).slice(0, excess)) delete next[key];
              }
              hydratedContentRef.current = next;
              return next;
            });
          }
        } catch {
          // The Convex preview remains visible when the local runtime or blob is unavailable.
        }
      }
    };

    const workerCount = Math.min(4, targets.length);
    void Promise.all(Array.from({ length: workerCount }, () => hydrateNext()));
    return () => controller.abort();
  }, [messageSummaries]);

  const projectItems = useMemo(() => {
    const items = projectPage?.items ?? [];
    if (!activeProjectRecord || items.some((item) => item.id === activeProjectRecord.id)) {
      return items;
    }
    return [activeProjectRecord, ...items];
  }, [activeProjectRecord, projectPage]);
  const projects = useMemo<ProjectSummary[]>(
    () =>
      projectItems.map((project, index) => ({
        id: String(project.id),
        publicId: project.publicId,
        name: project.name,
        color: PROJECT_COLORS[index % PROJECT_COLORS.length] ?? "terracotta",
      })),
    [projectItems],
  );
  const chats = useMemo<ChatSummary[]>(
    () =>
      chatItems.map((item) => ({
        id: String(item.id),
        publicId: item.publicId,
        rootBranchPublicId: item.rootBranchPublicId,
        projectId: item.projectId ? String(item.projectId) : undefined,
        title: item.title,
        updatedAt: item.updatedAt,
        branchCount: item.id === chat?.id && tree ? tree.branches.length : 1,
      })),
    [chat?.id, chatItems, tree],
  );
  const branches = useMemo<ChatBranch[]>(() => {
    if (!tree) return [];
    return tree.branches.map((branch) => {
      const result = messageResults[String(branch.id)];
      const page = result && !(result instanceof Error) ? (result as MessagePage) : undefined;
      const messages =
        page?.items.map((message) => messageFromEnvelope(message, hydratedContent)) ?? [];
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
                selectionStart: branch.anchorSelection?.start,
                selectionEnd: branch.anchorSelection?.end,
                prompt: branch.anchorPrompt ?? "",
              },
        messages,
      };
    });
  }, [hydratedContent, messageResults, tree]);

  const createWorkspaceMutation = useMutation(domainApi.workspaces.create);
  const createProjectMutation = useMutation(domainApi.projects.create);
  const createChatMutation = useMutation(domainApi.chats.create);
  const claimAutoTitleMutation = useMutation(domainApi.chats.claimAutoTitle);
  const releaseAutoTitleMutation = useMutation(domainApi.chats.releaseAutoTitle);
  const completeAutoTitleMutation = useMutation(domainApi.chats.completeAutoTitle);
  const ensureInitialChatMutation = useMutation(domainApi.chats.ensureInitial);
  const createBranchMutation = useMutation(domainApi.branches.create);
  const reserveBlobMutation = useMutation(domainApi.blobManifests.reserve);
  const markBlobAvailableMutation = useMutation(domainApi.blobManifests.markAvailable);
  const appendMessageMutation = useMutation(domainApi.messages.append);
  const createRunMutation = useMutation(domainApi.runs.create);
  const completeRunMutation = useMutation(domainApi.runs.complete);
  const bootstrapAttemptsRef = useRef(new Set<string>());
  const bootstrapFailuresRef = useRef(new Map<string, number>());
  const bootstrapRetryTimersRef = useRef(new Map<string, number>());
  const activeWorkspaceIdRef = useRef<string>();
  const [bootstrappingWorkspaceId, setBootstrappingWorkspaceId] = useState<string>();
  const [bootstrapRetryNonce, setBootstrapRetryNonce] = useState(0);
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
    async (input: { name: string; storageMode: "local" | "cloud"; initialChatTitle: string }) => {
      if (!authenticated) return null;
      const createdWorkspace = await createWorkspaceMutation({
        name: input.name,
        storageMode: input.storageMode,
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
              }
            : undefined,
        prompt: anchor.prompt || undefined,
      });
    },
    [chat, createBranchMutation, workspace],
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
    branches,
    claimAutoTitle,
    completeAutoTitle,
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
    releaseAutoTitle,
    selectChat: setSelectedChatId,
    selectWorkspace,
    workspace: workspace as WorkspaceItem | undefined,
    workspaces: workspaceItems,
  };
}
