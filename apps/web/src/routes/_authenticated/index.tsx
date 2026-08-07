/** Main Monte Carlo workspace route. */

import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceApp } from "@/components/WorkspaceApp";

export const Route = createFileRoute("/_authenticated/")({
  validateSearch: (search: Record<string, unknown>) => ({
    workspace: typeof search.workspace === "string" ? search.workspace : undefined,
    chat: typeof search.chat === "string" ? search.chat : undefined,
    branch: typeof search.branch === "string" ? search.branch : undefined,
    view: search.view === "canvas" ? ("canvas" as const) : ("thread" as const),
  }),
  component: WorkspaceApp,
});
