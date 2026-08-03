/** Keeps the Convex dev --run init hook stable for template worktrees. */

import { internalMutation } from "./_generated/server";

const init = internalMutation({
  args: {},
  handler: async () => {},
});

export default init;
