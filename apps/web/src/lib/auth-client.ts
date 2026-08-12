/** Creates the Better Auth client used by the web app. */

import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const packagedDesktop = window.location.protocol === "app:";

export const authClient = createAuthClient({
  baseURL: packagedDesktop
    ? window.monteCarloDesktop?.convexSiteUrl
    : import.meta.env.VITE_CONVEX_SITE_URL,
  plugins: [convexClient(), crossDomainClient(), magicLinkClient()],
});
