/** Dev-only backend actions for wiping and reseeding the local database. */

import { components, internal } from "../_generated/api";
import type { TableNames } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { action, internalMutation } from "../_generated/server";
import { devToolsEnabled } from "../env";
import { logger } from "../lib/logger";

const APP_TABLES = [
  "users",
  "auth_audit_logs",
  "app_events_outbox",
  "app_analytics_flush_state",
  "dev_magic_links",
  "workspace_memberships",
  "projects",
  "chat_user_states",
  "messages",
  "agent_runs",
  "chat_branches",
  "chats",
  "blob_manifests",
  "workspaces",
] as const satisfies readonly TableNames[];

const BETTER_AUTH_MODELS = [
  "user",
  "session",
  "account",
  "verification",
  "twoFactor",
  "oauthApplication",
  "oauthAccessToken",
  "oauthConsent",
  "jwks",
  "rateLimit",
] as const;

function assertDevTools(): void {
  if (!devToolsEnabled) {
    throw new Error(
      "Dev tools require SITE_URL to be localhost and ENABLE_DANGEROUS_DEV_TOOLS=true.",
    );
  }
}

async function requireAuthenticatedDevTools(ctx: ActionCtx): Promise<void> {
  assertDevTools();
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required.");
  }
}

async function wipeAppTables(ctx: MutationCtx): Promise<number> {
  let totalDeleted = 0;

  for (const table of APP_TABLES) {
    while (true) {
      const batch = await ctx.db.query(table).take(500);
      if (batch.length === 0) break;

      for (const doc of batch) {
        await ctx.db.delete(doc._id);
      }
      totalDeleted += batch.length;
    }
  }

  return totalDeleted;
}

async function wipeBetterAuthTables(ctx: MutationCtx): Promise<void> {
  for (const model of BETTER_AUTH_MODELS) {
    let cursor: string | null = null;
    let done = false;

    while (!done) {
      const result: { isDone: boolean; continueCursor: string } = await ctx.runMutation(
        components.betterAuth.adapter.deleteMany,
        {
          input: { model },
          paginationOpts: { cursor, numItems: 500 },
        },
      );
      done = result.isDone;
      cursor = result.continueCursor;
    }
  }
}

export const wipeAllInternal = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ totalDeleted: number }> => {
    assertDevTools();
    const totalDeleted = await wipeAppTables(ctx);
    await wipeBetterAuthTables(ctx);
    logger.debug(`DevTools: wiped ${totalDeleted} app documents and Better Auth tables.`);
    return { totalDeleted };
  },
});

export const wipeAll = action({
  args: {},
  handler: async (ctx): Promise<{ totalDeleted: number }> => {
    await requireAuthenticatedDevTools(ctx);
    return ctx.runMutation(internal.functions.devTools.wipeAllInternal, {});
  },
});

export const reseed = action({
  args: {},
  handler: async (ctx): Promise<{ ok: true }> => {
    await requireAuthenticatedDevTools(ctx);
    await ctx.runMutation(internal.init.default, {});
    logger.debug("DevTools: reran init seed.");
    return { ok: true };
  },
});

export const wipeAndReseed = action({
  args: {},
  handler: async (ctx): Promise<{ totalDeleted: number }> => {
    await requireAuthenticatedDevTools(ctx);
    const result: { totalDeleted: number } = await ctx.runMutation(
      internal.functions.devTools.wipeAllInternal,
      {},
    );
    await ctx.runMutation(internal.init.default, {});
    logger.debug("DevTools: wiped and reran init seed.");
    return result;
  },
});
