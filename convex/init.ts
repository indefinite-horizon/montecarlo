/** Seeds the account-free identity and its initial durable local workspace graph. */

import { internalMutation } from "./_generated/server";
import { localAnonymousWorkspacesEnabled } from "./env";
import { ensureLocalAnonymousWorkspace } from "./lib/localWorkspaceBootstrap";

const init = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!localAnonymousWorkspacesEnabled) return;
    await ensureLocalAnonymousWorkspace(ctx);
  },
});

export default init;
