/** Shared validators for the workspace-scoped conversation domain. */

import { type Infer, v } from "convex/values";

export const workspaceRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer"),
);
export type WorkspaceRole = Infer<typeof workspaceRoleValidator>;

export const workspaceMembershipStatusValidator = v.union(
  v.literal("invited"),
  v.literal("active"),
  v.literal("suspended"),
  v.literal("removed"),
);
export type WorkspaceMembershipStatus = Infer<typeof workspaceMembershipStatusValidator>;

export const workspaceStorageModeValidator = v.union(v.literal("local"), v.literal("cloud"));

export const workspacePermissionValidator = v.union(
  v.literal("workspace:read"),
  v.literal("workspace:manage"),
  v.literal("members:manage"),
  v.literal("content:read"),
  v.literal("content:write"),
  v.literal("runs:execute"),
);
export type WorkspacePermission = Infer<typeof workspacePermissionValidator>;

export const branchAnchorTypeValidator = v.union(
  v.literal("root"),
  v.literal("prompt"),
  v.literal("message"),
  v.literal("selection"),
);

export const branchSelectionValidator = v.object({
  start: v.number(),
  end: v.number(),
  quote: v.string(),
});

export const messageRoleValidator = v.union(
  v.literal("system"),
  v.literal("user"),
  v.literal("assistant"),
  v.literal("tool"),
);
export type MessageRole = Infer<typeof messageRoleValidator>;

export const runRuntimeValidator = v.union(v.literal("model"), v.literal("harness"));

export const providerIds = ["codex", "openrouter", "ollama", "anthropic"] as const;
export type ProviderId = (typeof providerIds)[number];
export const providerIdValidator = v.union(...providerIds.map((provider) => v.literal(provider)));

export const reasoningEffortValidator = v.union(
  v.literal("none"),
  v.literal("minimal"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh"),
  v.literal("max"),
);
export type ReasoningEffort = Infer<typeof reasoningEffortValidator>;

export const runStatusValidator = v.union(
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const terminalRunStatusValidator = v.union(
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled"),
);
export type TerminalRunStatus = Infer<typeof terminalRunStatusValidator>;

export const blobBackendValidator = v.union(v.literal("filesystem"), v.literal("r2"));

export const blobStatusValidator = v.union(
  v.literal("reserved"),
  v.literal("available"),
  v.literal("deleted"),
);
