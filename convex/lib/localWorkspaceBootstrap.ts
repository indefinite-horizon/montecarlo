/** Idempotently creates the durable graph required by account-free local mode. */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { convexConfig } from "../config";
import { LOCAL_ANONYMOUS_AUTH_SUBJECT } from "./localIdentity";

export type LocalWorkspaceBootstrapResult = {
  userId: Id<"users">;
  workspaceId: Id<"workspaces">;
  chatId: Id<"chats">;
  rootBranchId: Id<"chat_branches">;
};

async function ensureLocalUser(ctx: MutationCtx, now: number): Promise<Doc<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (query) => query.eq("authSubject", LOCAL_ANONYMOUS_AUTH_SUBJECT))
    .unique();
  if (existing) return existing;

  const userId = await ctx.db.insert("users", {
    authSubject: LOCAL_ANONYMOUS_AUTH_SUBJECT,
    name: convexConfig.dev.localWorkspaceBootstrap.userName,
    createdAt: now,
    updatedAt: now,
  });
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Local workspace identity could not be initialized.");
  return user;
}

async function ensureDefaultWorkspace(
  ctx: MutationCtx,
  user: Doc<"users">,
  now: number,
): Promise<Doc<"workspaces">> {
  const activeMembership = await ctx.db
    .query("workspace_memberships")
    .withIndex("by_user_status", (query) => query.eq("userId", user._id).eq("status", "active"))
    .first();
  if (activeMembership) {
    const activeWorkspace = await ctx.db.get(activeMembership.workspaceId);
    if (activeWorkspace) return activeWorkspace;
  }

  const bootstrapConfig = convexConfig.dev.localWorkspaceBootstrap;
  let workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_public_id", (query) => query.eq("publicId", bootstrapConfig.workspacePublicId))
    .unique();
  if (workspace && workspace.createdByUserId !== user._id) {
    throw new Error("The local bootstrap workspace is owned by another user.");
  }
  if (!workspace) {
    const workspaceId = await ctx.db.insert("workspaces", {
      publicId: bootstrapConfig.workspacePublicId,
      name: bootstrapConfig.workspaceName,
      storageMode: "local",
      schemaVersion: convexConfig.domain.workspaceSchemaVersion,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
    workspace = await ctx.db.get(workspaceId);
    if (!workspace) throw new Error("Local workspace could not be initialized.");
  }

  const membership = await ctx.db
    .query("workspace_memberships")
    .withIndex("by_workspace_user", (query) =>
      query.eq("workspaceId", workspace._id).eq("userId", user._id),
    )
    .unique();
  if (membership) {
    if (membership.status !== "active" || membership.role !== "owner") {
      await ctx.db.patch(membership._id, { status: "active", role: "owner", updatedAt: now });
    }
  } else {
    const publicIdCollision = await ctx.db
      .query("workspace_memberships")
      .withIndex("by_workspace_public_id", (query) =>
        query.eq("workspaceId", workspace._id).eq("publicId", bootstrapConfig.membershipPublicId),
      )
      .unique();
    if (publicIdCollision) {
      throw new Error("The local bootstrap membership public ID is already in use.");
    }
    await ctx.db.insert("workspace_memberships", {
      publicId: bootstrapConfig.membershipPublicId,
      workspaceId: workspace._id,
      userId: user._id,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  return workspace;
}

async function ensureRootBranch(
  ctx: MutationCtx,
  userId: Id<"users">,
  chat: Doc<"chats">,
  now: number,
): Promise<Doc<"chat_branches">> {
  if (chat.rootBranchId) {
    const rootBranch = await ctx.db.get(chat.rootBranchId);
    if (
      rootBranch &&
      rootBranch.workspaceId === chat.workspaceId &&
      rootBranch.chatId === chat._id &&
      rootBranch.anchorType === "root"
    ) {
      if (chat.rootBranchPublicId !== rootBranch.publicId) {
        await ctx.db.patch(chat._id, { rootBranchPublicId: rootBranch.publicId });
      }
      return rootBranch;
    }
  }

  const existingRoot = await ctx.db
    .query("chat_branches")
    .withIndex("by_workspace_chat_created_at", (query) =>
      query.eq("workspaceId", chat.workspaceId).eq("chatId", chat._id),
    )
    .order("asc")
    .first();
  if (existingRoot?.anchorType === "root") {
    await ctx.db.patch(chat._id, {
      rootBranchId: existingRoot._id,
      rootBranchPublicId: existingRoot.publicId,
    });
    return existingRoot;
  }

  const rootBranchPublicId = convexConfig.dev.localWorkspaceBootstrap.rootBranchPublicId;
  const publicIdCollision = await ctx.db
    .query("chat_branches")
    .withIndex("by_workspace_public_id", (query) =>
      query.eq("workspaceId", chat.workspaceId).eq("publicId", rootBranchPublicId),
    )
    .unique();
  if (publicIdCollision) {
    throw new Error("The local bootstrap branch public ID is already in use.");
  }

  const rootBranchId = await ctx.db.insert("chat_branches", {
    publicId: rootBranchPublicId,
    workspaceId: chat.workspaceId,
    chatId: chat._id,
    anchorType: "root",
    contextMessageIds: [],
    depth: 0,
    nextMessageOrdinal: 0,
    runLeaseVersion: 1,
    createdByUserId: userId,
    createdAt: now,
  });
  await ctx.db.patch(chat._id, { rootBranchId, rootBranchPublicId });
  const rootBranch = await ctx.db.get(rootBranchId);
  if (!rootBranch) throw new Error("Local root branch could not be initialized.");
  return rootBranch;
}

async function ensureInitialChat(
  ctx: MutationCtx,
  userId: Id<"users">,
  workspaceId: Id<"workspaces">,
  now: number,
): Promise<{ chat: Doc<"chats">; rootBranch: Doc<"chat_branches"> }> {
  let chat = await ctx.db
    .query("chats")
    .withIndex("by_workspace_archived_last_user_message_at", (query) =>
      query.eq("workspaceId", workspaceId).eq("archivedAt", undefined),
    )
    .order("desc")
    .first();
  if (!chat) {
    const bootstrapConfig = convexConfig.dev.localWorkspaceBootstrap;
    const chatId = await ctx.db.insert("chats", {
      publicId: bootstrapConfig.chatPublicId,
      workspaceId,
      title: bootstrapConfig.chatTitle,
      autoTitleStatus: "pending",
      rootBranchPublicId: bootstrapConfig.rootBranchPublicId,
      lastUserMessageAt: now,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    chat = await ctx.db.get(chatId);
    if (!chat) throw new Error("Local chat could not be initialized.");
  }

  return { chat, rootBranch: await ensureRootBranch(ctx, userId, chat, now) };
}

export async function ensureLocalAnonymousWorkspace(
  ctx: MutationCtx,
  now: number = Date.now(),
): Promise<LocalWorkspaceBootstrapResult> {
  const user = await ensureLocalUser(ctx, now);
  const workspace = await ensureDefaultWorkspace(ctx, user, now);
  const { chat, rootBranch } = await ensureInitialChat(ctx, user._id, workspace._id, now);
  return {
    userId: user._id,
    workspaceId: workspace._id,
    chatId: chat._id,
    rootBranchId: rootBranch._id,
  };
}
