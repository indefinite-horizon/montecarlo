/** Synchronizes portable workspace locations with TanStack Router. */

import { useNavigate } from "@tanstack/react-router";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  canGoBackInWorkspaceHistory,
  canGoForwardInWorkspaceHistory,
  createWorkspaceRouteHistory,
  isCompleteWorkspaceRoute,
  moveWorkspaceRouteHistory,
  pushWorkspaceRoute,
  reconcileWorkspaceRoute,
  replaceWorkspaceRoute,
  type WorkspaceRouteHistory,
  type WorkspaceRouteSearch,
  type WorkspaceView,
  workspaceRouteKey,
} from "@/lib/workspaceRouteHistory";
import type { useConversationController } from "./useConversationController";

export type { WorkspaceRouteSearch, WorkspaceView } from "@/lib/workspaceRouteHistory";

type ConversationController = ReturnType<typeof useConversationController>;

function browserPublicId(item: { publicId?: string }): string | undefined {
  return item.publicId;
}

export function useWorkspaceRouteSync({
  controller,
  routeSearch,
  view,
  setView,
  workspaceSelectionRequestRef,
}: {
  controller: ConversationController;
  routeSearch: WorkspaceRouteSearch;
  view: WorkspaceView;
  setView: Dispatch<SetStateAction<WorkspaceView>>;
  workspaceSelectionRequestRef: { current: number };
}) {
  const navigate = useNavigate({ from: "/" });
  const routeKey = workspaceRouteKey(routeSearch);
  const handledRouteKeyRef = useRef<string | undefined>(undefined);
  const pendingRouteKeyRef = useRef<string | undefined>(undefined);
  const lastRouteKeyRef = useRef<string | undefined>(undefined);
  const expectedRouteKeysRef = useRef<string[]>([]);
  const [appRouteHistory, setAppRouteHistory] = useState(() =>
    createWorkspaceRouteHistory(routeSearch),
  );
  const appRouteHistoryRef = useRef(appRouteHistory);
  const commitAppRouteHistory = useCallback((history: WorkspaceRouteHistory) => {
    if (history === appRouteHistoryRef.current) return;
    appRouteHistoryRef.current = history;
    setAppRouteHistory(history);
  }, []);
  const expectRoute = useCallback(
    (nextRouteKey: string) => {
      if (nextRouteKey === routeKey) return;
      expectedRouteKeysRef.current.push(nextRouteKey);
    },
    [routeKey],
  );
  const navigateToRoute = useCallback(
    (search: WorkspaceRouteSearch, replace = false) => {
      workspaceSelectionRequestRef.current += 1;
      const nextRouteKey = workspaceRouteKey(search);
      pendingRouteKeyRef.current = nextRouteKey === routeKey ? undefined : nextRouteKey;
      expectRoute(nextRouteKey);
      if (isCompleteWorkspaceRoute(search)) {
        commitAppRouteHistory(
          replace
            ? replaceWorkspaceRoute(appRouteHistoryRef.current, search)
            : pushWorkspaceRoute(appRouteHistoryRef.current, search),
        );
      }
      void navigate({ to: "/", replace, search });
    },
    [commitAppRouteHistory, expectRoute, navigate, routeKey, workspaceSelectionRequestRef],
  );
  const moveInAppHistory = useCallback(
    (delta: -1 | 1) => {
      const result = moveWorkspaceRouteHistory(appRouteHistoryRef.current, delta);
      if (!result.route) return;
      commitAppRouteHistory(result.history);
      workspaceSelectionRequestRef.current += 1;
      const nextRouteKey = workspaceRouteKey(result.route);
      pendingRouteKeyRef.current = nextRouteKey === routeKey ? undefined : nextRouteKey;
      expectRoute(nextRouteKey);
      // Replaying the app-owned stack replaces the browser entry so external
      // referrers and authentication redirects can never become app entries.
      void navigate({ to: "/", replace: true, search: result.route });
    },
    [commitAppRouteHistory, expectRoute, navigate, routeKey, workspaceSelectionRequestRef],
  );
  const goBack = useCallback(() => moveInAppHistory(-1), [moveInAppHistory]);
  const goForward = useCallback(() => moveInAppHistory(1), [moveInAppHistory]);

  // lint-allow: no-direct-use-effect — route changes restore persisted workspace selection.
  useEffect(() => {
    const routeChanged = lastRouteKeyRef.current !== routeKey;
    lastRouteKeyRef.current = routeKey;
    if (routeChanged) workspaceSelectionRequestRef.current += 1;
    if (routeChanged) {
      const expectedIndex = expectedRouteKeysRef.current.indexOf(routeKey);
      if (expectedIndex >= 0) {
        expectedRouteKeysRef.current.splice(0, expectedIndex + 1);
      } else {
        const currentRoute = {
          workspace: routeSearch.workspace,
          chat: routeSearch.chat,
          branch: routeSearch.branch,
          view: routeSearch.view,
        } satisfies WorkspaceRouteSearch;
        if (isCompleteWorkspaceRoute(currentRoute)) {
          commitAppRouteHistory(reconcileWorkspaceRoute(appRouteHistoryRef.current, currentRoute));
        }
      }
    }
    if (pendingRouteKeyRef.current === routeKey || (routeChanged && pendingRouteKeyRef.current)) {
      pendingRouteKeyRef.current = undefined;
    }
    if (pendingRouteKeyRef.current && pendingRouteKeyRef.current !== routeKey) return;

    setView(routeSearch.view);

    if (routeSearch.workspace) {
      const targetWorkspace = controller.workspaces.find(
        (workspace) => workspace.publicId === routeSearch.workspace,
      );
      if (targetWorkspace && controller.workspacePublicId !== routeSearch.workspace) {
        void controller.selectWorkspace(String(targetWorkspace.id));
        return;
      }
      if (!targetWorkspace && controller.loading) return;
      if (!targetWorkspace || controller.workspacePublicId !== routeSearch.workspace) {
        handledRouteKeyRef.current = routeKey;
        return;
      }
    }

    if (routeSearch.chat) {
      const targetChat = controller.chats.find(
        (chat) => browserPublicId(chat) === routeSearch.chat,
      );
      if (targetChat && controller.activeChatPublicId !== routeSearch.chat) {
        controller.selectChat(targetChat.id);
        return;
      }
      if (!targetChat && controller.loading) return;
      if (!targetChat || controller.activeChatPublicId !== routeSearch.chat) {
        handledRouteKeyRef.current = routeKey;
        return;
      }
    }

    if (routeSearch.branch) {
      const targetBranch = controller.branches.find(
        (branch) => browserPublicId(branch) === routeSearch.branch,
      );
      if (targetBranch && controller.activeBranchPublicId !== routeSearch.branch) {
        controller.setActiveBranchId(targetBranch.id);
        return;
      }
      if (!targetBranch && controller.loading) return;
      if (!targetBranch || controller.activeBranchPublicId !== routeSearch.branch) {
        handledRouteKeyRef.current = routeKey;
        return;
      }
    }

    handledRouteKeyRef.current = routeKey;
  }, [
    controller.activeBranchPublicId,
    controller.activeChatPublicId,
    controller.branches,
    controller.chats,
    controller.loading,
    controller.selectChat,
    controller.selectWorkspace,
    controller.setActiveBranchId,
    controller.workspacePublicId,
    controller.workspaces,
    commitAppRouteHistory,
    routeKey,
    routeSearch.branch,
    routeSearch.chat,
    routeSearch.view,
    routeSearch.workspace,
    setView,
    workspaceSelectionRequestRef,
  ]);

  // lint-allow: no-direct-use-effect — complete URLs only after portable IDs finish loading.
  useEffect(() => {
    if (pendingRouteKeyRef.current || handledRouteKeyRef.current !== routeKey) return;
    if (view !== routeSearch.view) return;
    if (
      !controller.workspacePublicId ||
      !controller.activeChatPublicId ||
      !controller.activeBranchPublicId
    ) {
      return;
    }
    const completeRoute = {
      workspace: controller.workspacePublicId,
      chat: controller.activeChatPublicId,
      branch: controller.activeBranchPublicId,
      view,
    } satisfies WorkspaceRouteSearch;
    if (workspaceRouteKey(completeRoute) === routeKey) return;
    navigateToRoute(completeRoute, true);
  }, [
    controller.activeBranchPublicId,
    controller.activeChatPublicId,
    controller.workspacePublicId,
    navigateToRoute,
    routeKey,
    routeSearch.view,
    view,
  ]);

  return {
    navigateToRoute,
    goBack,
    goForward,
    canGoBack: canGoBackInWorkspaceHistory(appRouteHistory),
    canGoForward: canGoForwardInWorkspaceHistory(appRouteHistory),
  };
}
