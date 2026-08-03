/** Root route: renders app chrome and recovers unmatched URLs back to home. */

import { createRootRouteWithContext, Outlet, useNavigate } from "@tanstack/react-router";
// lint-allow: no-direct-use-effect — not-found routes recover immediately.
import { useEffect } from "react";
import { toast } from "sonner";
import { DevToolsMenu } from "@/components/DevToolsMenu";
import { ErrorScreen } from "@/components/ErrorScreen";
import { useAnalytics } from "@/lib/analytics/context";
import { categorizeAppError } from "@/lib/analytics/events";
import type { RouterContext } from "@/lib/router-context";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFoundRedirect,
  errorComponent: RootErrorComponent,
});

function RootErrorComponent({ error }: { error: unknown }) {
  const { captureAppError } = useAnalytics();
  // lint-allow: no-direct-use-effect — route error boundaries report once on mount.
  useEffect(() => {
    captureAppError({ surface: "root", errorKind: categorizeAppError(error) });
  }, [captureAppError, error]);
  return <ErrorScreen error={error} />;
}

function RootComponent() {
  return (
    <>
      <Outlet />
      <DevToolsMenu />
    </>
  );
}

function NotFoundRedirect() {
  const navigate = useNavigate();
  // lint-allow: no-direct-use-effect — not-found routes recover immediately.
  useEffect(() => {
    toast.error("Page not found");
    void navigate({ to: "/", replace: true });
  }, [navigate]);

  return null;
}
