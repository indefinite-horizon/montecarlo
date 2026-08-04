/**
 * Shared defaults used by both backend and frontend runtimes.
 *
 * Use this file for product defaults that must stay identical across Convex
 * and the web app. Use `convex/config.ts` for backend runtime tuning.
 */

export const sharedConfig = {
  dev: {
    defaultAuthUser: {
      email: "test@test.local",
      name: "Test User",
    },
  },
  domain: {
    limits: {
      contentPreviewLength: 1_000,
    },
  },
} as const;
