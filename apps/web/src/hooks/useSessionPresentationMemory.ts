/** Keeps bounded, renderer-session presentation bookmarks for conversation surfaces. */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WorkspaceView } from "@/hooks/useWorkspaceRouteSync";
import type { ChatBranch } from "@/lib/conversation";
import {
  type CanvasViewportBookmark,
  createSessionPresentationMemory,
  peekCanvasViewport,
  peekThreadScroll,
  recallCanvasViewport,
  recallThreadScroll,
  rememberCanvasViewport,
  rememberThreadScroll,
  type SessionPresentationMemory,
  type ThreadScrollBookmark,
} from "@/lib/sessionPresentationMemory";

export function useSessionPresentationMemory({
  branches,
  branchId,
  chatId,
  view,
  workspaceId,
}: {
  branches: ReadonlyArray<Pick<ChatBranch, "id" | "publicId">>;
  branchId?: string;
  chatId?: string;
  view: WorkspaceView;
  workspaceId?: string;
}) {
  const memoryRef = useRef<SessionPresentationMemory>(createSessionPresentationMemory());
  const branchIdsKey = JSON.stringify(branches.map((branch) => branch.publicId ?? branch.id));
  const publicBranchIds = useMemo(() => JSON.parse(branchIdsKey) as string[], [branchIdsKey]);
  const initialThreadScrollBookmark = useMemo(() => {
    if (view !== "thread" || !workspaceId || !chatId || !branchId) return undefined;
    const bookmark = peekThreadScroll(memoryRef.current, {
      workspaceId,
      chatId,
      branchId,
      surface: "thread",
    });
    return bookmark;
  }, [branchId, chatId, view, workspaceId]);
  const initialCanvasViewport = useMemo(() => {
    if (view !== "canvas" || !workspaceId || !chatId) return undefined;
    return peekCanvasViewport(memoryRef.current, { workspaceId, chatId });
  }, [chatId, view, workspaceId]);
  const initialCanvasBranchScrollBookmarks = useMemo(() => {
    const bookmarks = new Map<string, ThreadScrollBookmark>();
    if (view !== "canvas" || !workspaceId || !chatId) return bookmarks;
    for (const publicBranchId of publicBranchIds) {
      const bookmark = peekThreadScroll(memoryRef.current, {
        workspaceId,
        chatId,
        branchId: publicBranchId,
        surface: "canvas-card",
      });
      if (bookmark) bookmarks.set(publicBranchId, bookmark);
    }
    return bookmarks;
  }, [chatId, publicBranchIds, view, workspaceId]);

  // lint-allow: no-direct-use-effect — record the focused surface visit in the session-only LRU.
  useEffect(() => {
    if (!workspaceId || !chatId) return;
    if (view === "thread") {
      if (!branchId) return;
      memoryRef.current = recallThreadScroll(memoryRef.current, {
        workspaceId,
        chatId,
        branchId,
        surface: "thread",
      }).memory;
      return;
    }
    memoryRef.current = recallCanvasViewport(memoryRef.current, { workspaceId, chatId }).memory;
  }, [branchId, chatId, view, workspaceId]);

  const rememberActiveThreadScroll = useCallback(
    (bookmark: ThreadScrollBookmark) => {
      if (!workspaceId || !chatId || !branchId) return;
      memoryRef.current = rememberThreadScroll(
        memoryRef.current,
        { workspaceId, chatId, branchId, surface: "thread" },
        bookmark,
      );
    },
    [branchId, chatId, workspaceId],
  );
  const rememberCanvasBranchScroll = useCallback(
    (publicBranchId: string, bookmark: ThreadScrollBookmark) => {
      if (!workspaceId || !chatId) return;
      memoryRef.current = rememberThreadScroll(
        memoryRef.current,
        { workspaceId, chatId, branchId: publicBranchId, surface: "canvas-card" },
        bookmark,
      );
    },
    [chatId, workspaceId],
  );
  const rememberActiveCanvasViewport = useCallback(
    (viewport: CanvasViewportBookmark) => {
      if (!workspaceId || !chatId) return;
      memoryRef.current = rememberCanvasViewport(
        memoryRef.current,
        { workspaceId, chatId },
        viewport,
      );
    },
    [chatId, workspaceId],
  );

  return {
    initialCanvasBranchScrollBookmarks,
    initialCanvasViewport,
    initialThreadScrollBookmark,
    rememberActiveCanvasViewport,
    rememberActiveThreadScroll,
    rememberCanvasBranchScroll,
  };
}
