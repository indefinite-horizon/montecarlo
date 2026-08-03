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
  dev: {
    defaultAuthUser: sharedConfig.dev.defaultAuthUser,
  },
} as const;
