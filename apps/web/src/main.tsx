/** Bootstraps the web app, Convex auth provider, TanStack Router, and global toasts. */

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { getAppName } from "@monte-carlo/app-constants";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ConvexReactClient } from "convex/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
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
const convexUrl =
  import.meta.env.VITE_CONVEX_URL ||
  (import.meta.env.DEV || packagedDesktop ? "http://127.0.0.1:3210" : "");

if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is required in production");
}

const appName = getAppName(import.meta.env.DEV);
document.title = appName;

if (import.meta.env.DEV) {
  const portLabel = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  const branchLabel = import.meta.env.VITE_DEV_GIT_BRANCH?.trim();
  document.title = `${appName} (port: ${portLabel}${branchLabel ? `, ${branchLabel}` : ""})`;
}

const convexClient = new ConvexReactClient(convexUrl, {
  expectAuth: true,
});

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
  const { data: session } = authClient.useSession();
  return <RouterProvider router={router} context={{ session, convexClient }} />;
}

function App() {
  const themeCtx = useThemeProvider();

  return (
    <ThemeContext.Provider value={themeCtx}>
      <AnalyticsProvider>
        <ConvexBetterAuthProvider client={convexClient} authClient={authClient}>
          <InnerApp />
        </ConvexBetterAuthProvider>
        <Toaster theme={themeCtx.resolvedTheme} />
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
