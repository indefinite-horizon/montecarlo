/** Main Monte Carlo workspace route. */

import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceApp } from "@/components/WorkspaceApp";

export const Route = createFileRoute("/_authenticated/")({
  component: WorkspaceApp,
});
