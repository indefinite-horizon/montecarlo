/** Typed domain references layered over the existing generated Convex API proxy. */

import type { FunctionReference } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ProviderId, ReasoningEffort } from "./conversation";

type PublicQuery<Args extends Record<string, unknown>, Result> = FunctionReference<
  "query",
  "public",
  Args,
  Result
>;
type PublicMutation<Args extends Record<string, unknown>, Result> = FunctionReference<
  "mutation",
  "public",
  Args,
  Result
>;

export type WorkspaceItem = {
  id: Id<"workspaces">;
  publicId: string;
  name: string;
  storageMode: "local" | "cloud";
  schemaVersion: number;
  role: "owner" | "admin" | "member" | "viewer";
  membershipStatus: "invited" | "active" | "suspended" | "removed";
  permissions: string[];
  createdAt: number;
  updatedAt: number;
};

type ProjectItem = {
  id: Id<"projects">;
  publicId: string;
  workspaceId: Id<"workspaces">;
  name: string;
  description?: string;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type ChatItem = {
  id: Id<"chats">;
  publicId: string;
  workspaceId: Id<"workspaces">;
  projectId?: Id<"projects">;
  title: string;
  autoTitleStatus?: "pending" | "generating" | "generated";
  autoTitleReady?: boolean;
  rootBranchId: Id<"chat_branches">;
  rootBranchPublicId: string;
  latestCompletedMessagePublicId?: string;
  lastUserMessageAt: number;
  isUnread: boolean;
  isPinned: boolean;
  pinnedAt?: number;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type BranchItem = {
  id: Id<"chat_branches">;
  publicId: string;
  workspaceId?: Id<"workspaces">;
  chatId?: Id<"chats">;
  parentBranchId?: Id<"chat_branches">;
  anchorType: "root" | "prompt" | "message" | "selection";
  anchorSourceBranchId?: Id<"chat_branches">;
  anchorSourceMessageId?: Id<"messages">;
  anchorSelection?: { start: number; end: number; quote: string; displayText?: string };
  anchorPrompt?: string;
  title?: string;
  contextMessageIds: Id<"messages">[];
  contextPreview?: string;
  depth: number;
  createdAt: number;
};

export type MessageItem = {
  id: Id<"messages">;
  publicId: string;
  workspaceId: Id<"workspaces">;
  chatId: Id<"chats">;
  branchId: Id<"chat_branches">;
  ordinal: number;
  role: "system" | "user" | "assistant" | "tool";
  contentRef: string;
  objectKey: string;
  backend: "filesystem" | "r2";
  envelopeVersion: number;
  contentPreview: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  replyToMessageId?: Id<"messages">;
  runId?: Id<"agent_runs">;
  provider?: string;
  model?: string;
  runStatus?: "running" | "succeeded" | "failed" | "canceled";
  createdAt: number;
};

export type BlobManifestItem = {
  id: Id<"blob_manifests">;
  publicId: string;
  workspaceId: Id<"workspaces">;
  backend: "filesystem" | "r2";
  objectKey: string;
  envelopeVersion: number;
  contentType: string;
  byteLength: number;
  sha256: string;
  status: "reserved" | "available" | "deleted";
  createdAt: number;
  updatedAt: number;
};

export type MessagePage = {
  items: MessageItem[];
  nextBeforeOrdinal: number | null;
  hasMore: boolean;
};

export type RunItem = {
  id: Id<"agent_runs">;
  publicId: string;
  workspaceId: Id<"workspaces">;
  chatId: Id<"chats">;
  branchId: Id<"chat_branches">;
  inputMessageId?: Id<"messages">;
  outputMessageId?: Id<"messages">;
  runtime: "model" | "harness";
  provider: string;
  model: string;
  providerSessionId?: string;
  reasoningEffort?: ReasoningEffort | "none" | "minimal";
  fastMode?: boolean;
  status: "running" | "succeeded" | "failed" | "canceled";
  errorCode?: string;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type DomainApi = {
  workspaces: {
    getByPublicId: PublicQuery<{ publicId: string }, WorkspaceItem | null>;
    list: PublicQuery<{ limit?: number }, { items: WorkspaceItem[]; hasMore: boolean }>;
    create: PublicMutation<
      {
        publicId?: string;
        membershipPublicId?: string;
        name: string;
        storageMode: "local" | "cloud";
      },
      WorkspaceItem
    >;
  };
  projects: {
    get: PublicQuery<
      { workspaceId: Id<"workspaces">; projectId: Id<"projects"> },
      ProjectItem | null
    >;
    list: PublicQuery<
      { workspaceId: Id<"workspaces">; limit?: number },
      { items: ProjectItem[]; hasMore: boolean }
    >;
    create: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        publicId?: string;
        name: string;
        description?: string;
      },
      ProjectItem
    >;
  };
  chats: {
    getByPublicId: PublicQuery<
      { workspaceId: Id<"workspaces">; publicId: string },
      ChatItem | null
    >;
    list: PublicQuery<
      { workspaceId: Id<"workspaces">; projectId?: Id<"projects">; limit?: number },
      { items: ChatItem[]; hasMore: boolean }
    >;
    create: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        projectId?: Id<"projects">;
        publicId?: string;
        rootBranchPublicId?: string;
        title: string;
        autoTitle?: boolean;
      },
      ChatItem
    >;
    archive: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        chatPublicId: string;
        replacementTitle: string;
      },
      {
        archived: boolean;
        nextChatPublicId: string;
        nextRootBranchPublicId: string;
      }
    >;
    restore: PublicMutation<{ workspaceId: Id<"workspaces">; chatPublicId: string }, boolean>;
    rename: PublicMutation<
      { workspaceId: Id<"workspaces">; chatPublicId: string; title: string },
      boolean
    >;
    setPinned: PublicMutation<
      { workspaceId: Id<"workspaces">; chatPublicId: string; pinned: boolean },
      boolean
    >;
    markUnread: PublicMutation<{ workspaceId: Id<"workspaces">; chatPublicId: string }, boolean>;
    markRead: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        chatPublicId: string;
        messagePublicId: string;
      },
      boolean
    >;
    claimAutoTitle: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        chatId: Id<"chats">;
        claimToken: string;
        provider?: ProviderId;
        model?: string;
      },
      { inputMessageId: Id<"messages">; intent: string; provider: ProviderId; model: string } | null
    >;
    releaseAutoTitle: PublicMutation<
      { workspaceId: Id<"workspaces">; chatId: Id<"chats">; claimToken: string },
      boolean
    >;
    completeAutoTitle: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        chatId: Id<"chats">;
        claimToken: string;
        title: string;
      },
      boolean
    >;
    ensureInitial: PublicMutation<
      { workspaceId: Id<"workspaces">; title: string; autoTitle?: boolean },
      ChatItem
    >;
    getTree: PublicQuery<
      {
        workspaceId: Id<"workspaces">;
        chatId: Id<"chats">;
        limit?: number;
        targetBranchPublicId?: string;
      },
      { chat: ChatItem; branches: BranchItem[]; truncated: boolean }
    >;
  };
  branches: {
    create: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        chatId: Id<"chats">;
        parentBranchId: Id<"chat_branches">;
        publicId?: string;
        sourceMessageId?: Id<"messages">;
        selection?: { start: number; end: number; quote: string; displayText?: string };
        prompt?: string;
      },
      BranchItem & {
        workspaceId: Id<"workspaces">;
        chatId: Id<"chats">;
        parentBranchId: Id<"chat_branches">;
        anchorSourceBranchId: Id<"chat_branches">;
      }
    >;
    completeAutoTitle: PublicMutation<
      { workspaceId: Id<"workspaces">; branchId: Id<"chat_branches">; title: string },
      boolean
    >;
  };
  messages: {
    list: PublicQuery<
      {
        workspaceId: Id<"workspaces">;
        branchId: Id<"chat_branches">;
        beforeOrdinal?: number;
        limit?: number;
      },
      MessagePage
    >;
    append: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        chatId: Id<"chats">;
        branchId: Id<"chat_branches">;
        publicId?: string;
        role: "system" | "user" | "assistant" | "tool";
        contentRef: string;
        contentPreview: string;
        replyToMessageId?: Id<"messages">;
        runId?: Id<"agent_runs">;
      },
      MessageItem
    >;
  };
  messageHistory: {
    truncateFromUserMessage: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        chatId: Id<"chats">;
        messagePublicId: string;
      },
      {
        branchId: Id<"chat_branches">;
        branchPublicId: string;
        removedBranchIds: Id<"chat_branches">[];
        removedMessagePublicIds: string[];
      }
    >;
  };
  blobManifests: {
    reserve: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        publicId?: string;
        backend: "filesystem" | "r2";
        envelopeVersion: number;
        contentType: string;
        byteLength: number;
        sha256: string;
      },
      BlobManifestItem
    >;
    markAvailable: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        manifestId: Id<"blob_manifests">;
        attestation: string;
      },
      BlobManifestItem
    >;
  };
  runs: {
    create: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        chatId: Id<"chats">;
        branchId: Id<"chat_branches">;
        publicId?: string;
        inputMessageId?: Id<"messages">;
        runtime: "model" | "harness";
        provider: string;
        model: string;
        providerSessionId?: string;
        reasoningEffort?: ReasoningEffort;
        fastMode?: boolean;
      },
      RunItem
    >;
    complete: PublicMutation<
      {
        workspaceId: Id<"workspaces">;
        runId: Id<"agent_runs">;
        status: "succeeded" | "failed" | "canceled";
        outputMessageId?: Id<"messages">;
        errorCode?: string;
        errorMessage?: string;
      },
      RunItem
    >;
  };
};

// `_generated/api.js` is a dynamic proxy at runtime. This cast can disappear
// after the next normal Convex codegen refresh adds these modules to api.d.ts.
export const domainApi = api as unknown as DomainApi;
