/** Internal mutations for writing authentication audit records. */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

export const write = internalMutation({
  args: {
    event: v.union(v.literal("auth.session_created"), v.literal("auth.account_linked")),
    actorAuthSubject: v.string(),
    provider: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auth_audit_logs", args);
  },
});
