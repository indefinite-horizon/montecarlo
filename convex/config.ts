/**
 * Centralized runtime defaults and tuning parameters for Convex backend code.
 *
 * Use this file for backend-only behavior. Use `../lib/config` for defaults
 * shared with the frontend.
 */

import { sharedConfig } from "../lib/config";

const oneSecondMs = 1000;
const oneMinuteMs = 60 * oneSecondMs;
const oneDayMs = 24 * 60 * oneMinuteMs;

export const convexConfig = {
  auth: {
    magicLink: {
      expiresInSeconds: 5 * 60,
      devLinkTtlMs: 5 * oneMinuteMs,
    },
  },
  analytics: {
    outbox: {
      maxAttempts: 5,
      lockTtlMs: oneMinuteMs,
      maxAgeMs: oneDayMs,
      batchSize: 50,
      pruneBatchSize: 200,
      minFlushIntervalMs: oneSecondMs,
      retryBackoffMs: [
        30 * oneSecondMs,
        oneMinuteMs,
        2 * oneMinuteMs,
        4 * oneMinuteMs,
        8 * oneMinuteMs,
      ],
    },
  },
  domain: {
    chatNaming: {
      claimLeaseMs: 5 * oneMinuteMs,
    },
    workspaceSchemaVersion: 1,
    limits: {
      defaultPageSize: 50,
      maxPageSize: 100,
      defaultTreeSize: 200,
      maxTreeSize: 500,
      maxBranchDepth: 256,
      maxBranchContextMessages: 16,
      publicIdLength: 128,
      workspaceNameLength: 120,
      projectNameLength: 160,
      projectDescriptionLength: 2_000,
      chatTitleLength: 200,
      contentPreviewLength: sharedConfig.domain.limits.contentPreviewLength,
      branchPromptLength: 16_000,
      selectionQuoteLength: 8_000,
      providerNameLength: 120,
      modelNameLength: 256,
      providerSessionIdLength: 512,
      errorCodeLength: 120,
      errorMessageLength: 2_000,
      contentTypeLength: 160,
    },
  },
  dev: {
    defaultAuthUser: sharedConfig.dev.defaultAuthUser,
    localWorkspaceBootstrap: {
      userName: "Local user",
      workspaceName: "Richard's workspace",
      workspacePublicId: "ws_local_default",
      membershipPublicId: "member_local_default_owner",
      chatTitle: "Pancakes",
      chatPublicId: "chat_local_default",
      rootBranchPublicId: "branch_local_default_root",
    },
  },
} as const;
