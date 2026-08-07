/** Login page route: shows auth UI, redirects to / if already authenticated. */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.session) {
      throw redirect({
        to: "/",
        search: { workspace: undefined, chat: undefined, branch: undefined, view: "thread" },
      });
    }
  },
  component: AuthPage,
});
