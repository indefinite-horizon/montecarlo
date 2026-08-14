/** Verifies that app navigation never depends on the browser's external history. */

import { describe, expect, it } from "vitest";
import {
  canGoBackInWorkspaceHistory,
  canGoForwardInWorkspaceHistory,
  createWorkspaceRouteHistory,
  moveWorkspaceRouteHistory,
  pushWorkspaceRoute,
  reconcileWorkspaceRoute,
  rememberedWorkspaceRouteForChat,
  rememberWorkspaceRoute,
  replaceWorkspaceRoute,
  type WorkspaceRouteSearch,
} from "../../apps/web/src/lib/workspaceRouteHistory";

function route(chat: string, overrides: Partial<WorkspaceRouteSearch> = {}): WorkspaceRouteSearch {
  return {
    workspace: "workspace-1",
    chat,
    branch: `${chat}-root`,
    view: "thread",
    ...overrides,
  };
}

describe("workspace route history", () => {
  it("starts at the app-entry boundary and ignores incomplete non-workspace locations", () => {
    const loginOrCallback = route("", {
      workspace: undefined,
      chat: undefined,
      branch: undefined,
    });
    const callbackHistory = createWorkspaceRouteHistory(loginOrCallback);
    expect(callbackHistory).toEqual({ entries: [], index: -1 });

    const initial = replaceWorkspaceRoute(callbackHistory, route("chat-a"));
    expect(canGoBackInWorkspaceHistory(initial)).toBe(false);
    expect(canGoForwardInWorkspaceHistory(initial)).toBe(false);
    expect(moveWorkspaceRouteHistory(initial, -1)).toEqual({
      history: initial,
      route: undefined,
    });

    expect(pushWorkspaceRoute(initial, loginOrCallback)).toBe(initial);
    expect(replaceWorkspaceRoute(initial, loginOrCallback)).toBe(initial);
  });

  it("restores every state-bearing query value with Back and Forward", () => {
    const first = route("chat-a");
    const second = route("chat-b", {
      workspace: "workspace-2",
      branch: "branch-b",
      view: "canvas",
    });
    const pushed = pushWorkspaceRoute(createWorkspaceRouteHistory(first), second);

    const back = moveWorkspaceRouteHistory(pushed, -1);
    expect(back.route).toEqual(first);
    expect(canGoBackInWorkspaceHistory(back.history)).toBe(false);
    expect(canGoForwardInWorkspaceHistory(back.history)).toBe(true);

    const forward = moveWorkspaceRouteHistory(back.history, 1);
    expect(forward.route).toEqual(second);
    expect(canGoBackInWorkspaceHistory(forward.history)).toBe(true);
    expect(canGoForwardInWorkspaceHistory(forward.history)).toBe(false);
  });

  it("does not duplicate the active route and replace does not add depth", () => {
    const first = route("chat-a");
    const initial = createWorkspaceRouteHistory(first);
    expect(pushWorkspaceRoute(initial, { ...first })).toBe(initial);

    const normalized = route("chat-a", { branch: "normalized-root" });
    const replaced = replaceWorkspaceRoute(initial, normalized);
    expect(replaced).toEqual({ entries: [normalized], index: 0 });
    expect(canGoBackInWorkspaceHistory(replaced)).toBe(false);
  });

  it("treats every state-bearing query field as part of the route identity", () => {
    const first = route("chat-a");
    const variants: WorkspaceRouteSearch[] = [
      { ...first, workspace: "workspace-2" },
      { ...first, chat: "chat-b" },
      { ...first, branch: "branch-b" },
      { ...first, view: "canvas" },
    ];

    for (const changedRoute of variants) {
      const history = pushWorkspaceRoute(createWorkspaceRouteHistory(first), changedRoute);
      expect(history.entries).toEqual([first, changedRoute]);
    }
  });

  it("truncates Forward after a new app route forks the stack", () => {
    const first = route("chat-a");
    const second = route("chat-b");
    const changedView = route("chat-a", { view: "canvas" });
    const afterSecond = pushWorkspaceRoute(createWorkspaceRouteHistory(first), second);
    const back = moveWorkspaceRouteHistory(afterSecond, -1).history;
    const forked = pushWorkspaceRoute(back, changedView);

    expect(forked.entries).toEqual([first, changedView]);
    expect(canGoForwardInWorkspaceHistory(forked)).toBe(false);
  });

  it("reconciles native same-app Back and Forward without importing external entries", () => {
    const first = route("chat-a");
    const second = route("chat-b");
    const atSecond = pushWorkspaceRoute(createWorkspaceRouteHistory(first), second);

    const atFirst = reconcileWorkspaceRoute(atSecond, first);
    expect(atFirst.index).toBe(0);
    expect(canGoForwardInWorkspaceHistory(atFirst)).toBe(true);
    expect(reconcileWorkspaceRoute(atFirst, second).index).toBe(1);
  });

  it("remembers the latest branch and view separately for each chat", () => {
    const chatAThread = route("chat-a", { branch: "branch-a-1" });
    const chatACanvas = route("chat-a", { branch: "branch-a-2", view: "canvas" });
    const chatBThread = route("chat-b", { branch: "branch-b-1" });
    const memory = rememberWorkspaceRoute(
      rememberWorkspaceRoute(rememberWorkspaceRoute(new Map(), chatAThread), chatACanvas),
      chatBThread,
    );

    expect(rememberedWorkspaceRouteForChat(memory, "workspace-1", "chat-a")).toEqual(chatACanvas);
    expect(rememberedWorkspaceRouteForChat(memory, "workspace-1", "chat-b")).toEqual(chatBThread);
    expect(rememberedWorkspaceRouteForChat(memory, "workspace-2", "chat-a")).toBeUndefined();
  });
});
