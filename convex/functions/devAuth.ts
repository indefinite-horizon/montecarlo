/** Provides dev-only helpers for Better Auth magic-link auto-login. */

import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import { convexConfig } from "../config";
import { isLocalDev } from "../env";

export const storeDevMagicLink = internalMutation({
  args: {
    email: v.string(),
    url: v.string(),
  },
  handler: async (ctx, { email, url }) => {
    if (!isLocalDev) return;

    const expiryCutoff = Date.now() - convexConfig.auth.magicLink.devLinkTtlMs;
    const existingLinks = await ctx.db
      .query("dev_magic_links")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(1000);
    const expiredLinks = await ctx.db
      .query("dev_magic_links")
      .withIndex("by_created_at", (q) => q.lt("createdAt", expiryCutoff))
      .take(1000);
    const deletedIds = new Set<string>();
    for (const doc of [...existingLinks, ...expiredLinks]) {
      if (deletedIds.has(doc._id)) continue;
      deletedIds.add(doc._id);
      await ctx.db.delete(doc._id);
    }

    await ctx.db.insert("dev_magic_links", {
      email,
      url,
      createdAt: Date.now(),
    });
  },
});

export const getDevMagicLink = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, { email }) => {
    if (!isLocalDev) return null;

    const link = await ctx.db
      .query("dev_magic_links")
      .withIndex("by_email", (q) => q.eq("email", email))
      .order("desc")
      .first();
    return link?.url ?? null;
  },
});
