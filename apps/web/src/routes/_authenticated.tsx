/** Auth guard layout: redirects unauthenticated routes to /login. */

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AnalyticsIdentityBridge } from "@/lib/analytics/identity";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <>
      <AnalyticsIdentityBridge />
      <Outlet />
    </>
  );
}
