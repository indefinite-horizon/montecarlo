/** Owns Back/Forward state for complete, in-app workspace locations. */

export type WorkspaceView = "thread" | "canvas";

export type WorkspaceRouteSearch = {
  workspace: string | undefined;
  chat: string | undefined;
  branch: string | undefined;
  view: WorkspaceView;
};

export type CompleteWorkspaceRouteSearch = WorkspaceRouteSearch & {
  workspace: string;
  chat: string;
  branch: string;
};

export type WorkspaceRouteHistory = Readonly<{
  entries: readonly CompleteWorkspaceRouteSearch[];
  index: number;
}>;

export function workspaceRouteKey(search: WorkspaceRouteSearch): string {
  return [search.workspace ?? "", search.chat ?? "", search.branch ?? "", search.view].join("\n");
}

export function isCompleteWorkspaceRoute(
  search: WorkspaceRouteSearch,
): search is CompleteWorkspaceRouteSearch {
  return Boolean(search.workspace && search.chat && search.branch);
}

function copyCompleteRoute(search: CompleteWorkspaceRouteSearch): CompleteWorkspaceRouteSearch {
  return {
    workspace: search.workspace,
    chat: search.chat,
    branch: search.branch,
    view: search.view,
  };
}

export function createWorkspaceRouteHistory(
  initialRoute?: WorkspaceRouteSearch,
): WorkspaceRouteHistory {
  if (!initialRoute || !isCompleteWorkspaceRoute(initialRoute)) {
    return { entries: [], index: -1 };
  }
  return { entries: [copyCompleteRoute(initialRoute)], index: 0 };
}

export function pushWorkspaceRoute(
  history: WorkspaceRouteHistory,
  route: WorkspaceRouteSearch,
): WorkspaceRouteHistory {
  if (!isCompleteWorkspaceRoute(route)) return history;
  const currentRoute = history.entries[history.index];
  if (currentRoute && workspaceRouteKey(currentRoute) === workspaceRouteKey(route)) return history;

  const entries = history.entries.slice(0, history.index + 1);
  entries.push(copyCompleteRoute(route));
  return { entries, index: entries.length - 1 };
}

export function replaceWorkspaceRoute(
  history: WorkspaceRouteHistory,
  route: WorkspaceRouteSearch,
): WorkspaceRouteHistory {
  if (!isCompleteWorkspaceRoute(route)) return history;
  if (history.index < 0) return createWorkspaceRouteHistory(route);

  const currentRoute = history.entries[history.index];
  if (currentRoute && workspaceRouteKey(currentRoute) === workspaceRouteKey(route)) return history;

  const entries = [...history.entries];
  entries[history.index] = copyCompleteRoute(route);
  return { entries, index: history.index };
}

/**
 * Reconciles a native same-app route change without ever reading browser history.
 * Adjacent entries preserve the existing Back/Forward cursor; all other app routes
 * become a new entry and truncate the old forward tail.
 */
export function reconcileWorkspaceRoute(
  history: WorkspaceRouteHistory,
  route: WorkspaceRouteSearch,
): WorkspaceRouteHistory {
  if (!isCompleteWorkspaceRoute(route)) return history;
  const routeKey = workspaceRouteKey(route);
  const currentRoute = history.entries[history.index];
  if (currentRoute && workspaceRouteKey(currentRoute) === routeKey) {
    return history;
  }
  const previousRoute = history.entries[history.index - 1];
  if (previousRoute && workspaceRouteKey(previousRoute) === routeKey) {
    return { entries: history.entries, index: history.index - 1 };
  }
  const nextRoute = history.entries[history.index + 1];
  if (nextRoute && workspaceRouteKey(nextRoute) === routeKey) {
    return { entries: history.entries, index: history.index + 1 };
  }
  return pushWorkspaceRoute(history, route);
}

export function moveWorkspaceRouteHistory(
  history: WorkspaceRouteHistory,
  delta: -1 | 1,
): Readonly<{
  history: WorkspaceRouteHistory;
  route: CompleteWorkspaceRouteSearch | undefined;
}> {
  const nextIndex = history.index + delta;
  if (nextIndex < 0 || nextIndex >= history.entries.length) {
    return { history, route: undefined };
  }
  return {
    history: { entries: history.entries, index: nextIndex },
    route: history.entries[nextIndex],
  };
}

export function canGoBackInWorkspaceHistory(history: WorkspaceRouteHistory): boolean {
  return history.index > 0;
}

export function canGoForwardInWorkspaceHistory(history: WorkspaceRouteHistory): boolean {
  return history.index >= 0 && history.index < history.entries.length - 1;
}
