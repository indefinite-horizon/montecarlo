/** Bootstraps the web app, Convex auth provider, TanStack Router, and global toasts. */

import {
  type AuthClient as ConvexAuthClient,
  ConvexBetterAuthProvider,
} from "@convex-dev/better-auth/react";
import { getAppName } from "@montecarlo/app-constants";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ConvexReactClient } from "convex/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { DesktopUpdateToast } from "./components/DesktopUpdateToast";
import { ErrorScreen } from "./components/ErrorScreen";
import { ThemeContext, useThemeProvider } from "./hooks/useTheme";
import "./i18n";
import { AnalyticsProvider, useAnalytics } from "./lib/analytics/context";
import { categorizeAppError } from "./lib/analytics/events";
import { authClient } from "./lib/auth-client";
import type { RouterContext } from "./lib/router-context";
import { routeTree } from "./routeTree.gen";
import "./styles/app.css";

const reactScanEnabled =
  import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN !== "false" && !navigator.webdriver;

if (reactScanEnabled) {
  void import("react-scan").then(({ scan }) => scan());
}

const packagedDesktop = window.location.protocol === "app:";
const convexUrl = packagedDesktop
  ? (window.monteCarloDesktop?.convexUrl ?? "")
  : import.meta.env.VITE_CONVEX_URL || (import.meta.env.DEV ? "http://127.0.0.1:3210" : "");

if (!convexUrl) {
  throw new Error(
    packagedDesktop
      ? "The packaged local data service did not provide its endpoint."
      : "VITE_CONVEX_URL is required in production",
  );
}

const appName = getAppName(import.meta.env.DEV);
document.title = appName;

if (import.meta.env.DEV) {
  const portLabel = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  const branchLabel = import.meta.env.VITE_DEV_GIT_BRANCH?.trim();
  document.title = `${appName} (port: ${portLabel}${branchLabel ? `, ${branchLabel}` : ""})`;
}

const convexClient = new ConvexReactClient(convexUrl, {
  expectAuth: import.meta.env.VITE_AUTH_REQUIRED === "true",
});

// TODO: Remove when https://github.com/get-convex/better-auth/issues/420 is fixed.
// Better Auth 1.6.22+ exposes a named client type that the provider's otherwise compatible
// AuthClient definition rejects. Keep the workaround at this single integration boundary.
const convexProviderAuthClient = authClient as unknown as ConvexAuthClient;

function RouteErrorComponent({ error }: { error: unknown }) {
  const { captureAppError } = useAnalytics();
  // lint-allow: no-direct-use-effect — route error boundaries report once on mount.
  React.useEffect(() => {
    captureAppError({ surface: "route", errorKind: categorizeAppError(error) });
  }, [captureAppError, error]);
  return <ErrorScreen error={error} />;
}

const router = createRouter({
  routeTree,
  context: {
    session: null,
    convexClient,
  } satisfies RouterContext,
  defaultPreload: "intent",
  defaultErrorComponent: RouteErrorComponent,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function InnerApp() {
  const { data: session, isPending } = authClient.useSession();

  // lint-allow: no-direct-use-effect — auth changes must rerun route guards.
  // biome-ignore lint/correctness/useExhaustiveDependencies: session is consumed by RouterProvider below, but its changes must also rerun route guards.
  React.useEffect(() => {
    if (isPending) return;
    void router.invalidate();
  }, [isPending, session]);

  // Do not mount auth-gated routes until Better Auth has completed its initial
  // session lookup. In cross-domain flows this also gives the provider time to
  // exchange the one-time token before a route guard can redirect to /login and
  // remove it from the URL.
  if (isPending) return null;

  return <RouterProvider router={router} context={{ session, convexClient }} />;
}

function App() {
  const themeCtx = useThemeProvider();
  const { t } = useTranslation();

  return (
    <ThemeContext.Provider value={themeCtx}>
      <AnalyticsProvider>
        <ConvexBetterAuthProvider client={convexClient} authClient={convexProviderAuthClient}>
          <InnerApp />
        </ConvexBetterAuthProvider>
        <DesktopUpdateToast />
        <Toaster
          theme={themeCtx.resolvedTheme}
          toastOptions={{ closeButtonAriaLabel: t("common.close") }}
        />
      </AnalyticsProvider>
    </ThemeContext.Provider>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
