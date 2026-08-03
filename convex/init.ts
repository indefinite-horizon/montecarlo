/** Seeds only the account-free identity used by an explicitly local deployment. */

import { internalMutation } from "./_generated/server";
import { localAnonymousWorkspacesEnabled } from "./env";
import { LOCAL_ANONYMOUS_AUTH_SUBJECT } from "./lib/localIdentity";

const init = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!localAnonymousWorkspacesEnabled) return;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_auth_subject", (query) =>
        query.eq("authSubject", LOCAL_ANONYMOUS_AUTH_SUBJECT),
      )
      .unique();
    if (existing) return;
    const now = Date.now();
    await ctx.db.insert("users", {
      authSubject: LOCAL_ANONYMOUS_AUTH_SUBJECT,
      name: "Local user",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export default init;
