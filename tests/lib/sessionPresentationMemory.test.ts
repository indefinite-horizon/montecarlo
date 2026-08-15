/** Verifies bounded session memory for conversation presentation state. */

import { describe, expect, it } from "vitest";
import {
  createSessionPresentationMemory,
  peekCanvasViewport,
  peekThreadScroll,
  recallCanvasViewport,
  recallThreadScroll,
  rememberCanvasViewport,
  rememberThreadScroll,
  sessionPresentationMemorySize,
  type ThreadScrollMemoryKey,
} from "../../apps/web/src/lib/sessionPresentationMemory";

function threadKey(overrides: Partial<ThreadScrollMemoryKey> = {}): ThreadScrollMemoryKey {
  return {
    workspaceId: "workspace-a",
    chatId: "chat-a",
    branchId: "branch-a",
    surface: "thread",
    ...overrides,
  };
}

describe("session presentation memory", () => {
  it("isolates main-thread and Canvas-card scroll bookmarks by every owner", () => {
    const cases = [
      threadKey(),
      threadKey({ workspaceId: "workspace-b" }),
      threadKey({ chatId: "chat-b" }),
      threadKey({ branchId: "branch-b" }),
      threadKey({ surface: "canvas-card" }),
    ] as const;
    const bookmarks = cases.map((_, index) => ({
      kind: "message-anchor" as const,
      messageId: `message-${index}`,
      offset: index * 10,
    }));
    let memory = createSessionPresentationMemory();
    for (const [index, key] of cases.entries()) {
      memory = rememberThreadScroll(memory, key, bookmarks[index]);
    }

    for (const [index, key] of cases.entries()) {
      const recalled = recallThreadScroll(memory, key);
      memory = recalled.memory;
      expect(recalled.value).toEqual(bookmarks[index]);
    }
    expect(recallThreadScroll(memory, threadKey({ branchId: "missing" })).value).toBeUndefined();
  });

  it("stores follow-latest independently from anchored scrolling", () => {
    const anchorKey = threadKey();
    const latestKey = threadKey({ branchId: "branch-b" });
    let memory = rememberThreadScroll(createSessionPresentationMemory(), anchorKey, {
      kind: "message-anchor",
      messageId: "message-a",
      offset: -12.5,
    });
    memory = rememberThreadScroll(memory, latestKey, { kind: "follow-latest" });

    expect(recallThreadScroll(memory, anchorKey).value).toEqual({
      kind: "message-anchor",
      messageId: "message-a",
      offset: -12.5,
    });
    expect(recallThreadScroll(memory, latestKey).value).toEqual({ kind: "follow-latest" });
  });

  it("isolates Canvas viewports by workspace and chat", () => {
    const first = { workspaceId: "workspace-a", chatId: "chat-a" };
    const second = { workspaceId: "workspace-a", chatId: "chat-b" };
    const third = { workspaceId: "workspace-b", chatId: "chat-a" };
    let memory = rememberCanvasViewport(createSessionPresentationMemory(), first, {
      x: 11,
      y: 22,
      zoom: 0.5,
    });
    memory = rememberCanvasViewport(memory, second, { x: 33, y: 44, zoom: 0.75 });
    memory = rememberCanvasViewport(memory, third, { x: 55, y: 66, zoom: 1.25 });

    expect(recallCanvasViewport(memory, first).value).toEqual({ x: 11, y: 22, zoom: 0.5 });
    expect(recallCanvasViewport(memory, second).value).toEqual({ x: 33, y: 44, zoom: 0.75 });
    expect(recallCanvasViewport(memory, third).value).toEqual({ x: 55, y: 66, zoom: 1.25 });
  });

  it("updates recency on writes and successful reads before evicting globally", () => {
    const oldestThread = threadKey({ branchId: "oldest" });
    const recentThread = threadKey({ branchId: "recent" });
    const canvas = { workspaceId: "workspace-a", chatId: "chat-canvas" };
    let memory = createSessionPresentationMemory(2);
    memory = rememberThreadScroll(memory, oldestThread, { kind: "follow-latest" });
    memory = rememberThreadScroll(memory, recentThread, { kind: "follow-latest" });
    memory = recallThreadScroll(memory, oldestThread).memory;
    memory = rememberCanvasViewport(memory, canvas, { x: 1, y: 2, zoom: 1 });

    expect(sessionPresentationMemorySize(memory)).toBe(2);
    expect(recallThreadScroll(memory, recentThread).value).toBeUndefined();
    expect(recallThreadScroll(memory, oldestThread).value).toEqual({ kind: "follow-latest" });
    expect(recallCanvasViewport(memory, canvas).value).toEqual({ x: 1, y: 2, zoom: 1 });
  });

  it("promotes an overwritten entry before evicting", () => {
    const first = threadKey({ branchId: "first" });
    const second = threadKey({ branchId: "second" });
    const third = threadKey({ branchId: "third" });
    let memory = createSessionPresentationMemory(2);
    memory = rememberThreadScroll(memory, first, { kind: "follow-latest" });
    memory = rememberThreadScroll(memory, second, { kind: "follow-latest" });
    memory = rememberThreadScroll(memory, first, {
      kind: "message-anchor",
      messageId: "updated-first",
      offset: 8,
    });
    memory = rememberThreadScroll(memory, third, { kind: "follow-latest" });

    expect(peekThreadScroll(memory, second)).toBeUndefined();
    expect(peekThreadScroll(memory, first)).toEqual({
      kind: "message-anchor",
      messageId: "updated-first",
      offset: 8,
    });
    expect(peekThreadScroll(memory, third)).toEqual({ kind: "follow-latest" });
  });

  it("evicts the least-recent entry across chats instead of keeping every visited surface", () => {
    const chatAThread = threadKey({ chatId: "chat-a" });
    const chatACanvas = { workspaceId: "workspace-a", chatId: "chat-a" };
    const chatBThread = threadKey({ chatId: "chat-b" });
    let memory = createSessionPresentationMemory(2);
    memory = rememberThreadScroll(memory, chatAThread, {
      kind: "message-anchor",
      messageId: "message-a",
      offset: 24,
    });
    memory = rememberCanvasViewport(memory, chatACanvas, { x: 10, y: 20, zoom: 0.8 });
    memory = rememberThreadScroll(memory, chatBThread, { kind: "follow-latest" });

    expect(peekThreadScroll(memory, chatAThread)).toBeUndefined();
    expect(peekCanvasViewport(memory, chatACanvas)).toEqual({ x: 10, y: 20, zoom: 0.8 });
    expect(peekThreadScroll(memory, chatBThread)).toEqual({ kind: "follow-latest" });
  });

  it("overwrites in place, returns copies, and rejects invalid capacities", () => {
    const key = threadKey();
    let memory = rememberThreadScroll(createSessionPresentationMemory(1), key, {
      kind: "message-anchor",
      messageId: "before",
      offset: 10,
    });
    memory = rememberThreadScroll(memory, key, {
      kind: "message-anchor",
      messageId: "after",
      offset: 20,
    });
    const firstRecall = recallThreadScroll(memory, key);
    const secondRecall = recallThreadScroll(firstRecall.memory, key);

    expect(sessionPresentationMemorySize(memory)).toBe(1);
    expect(firstRecall.value).toEqual({ kind: "message-anchor", messageId: "after", offset: 20 });
    expect(secondRecall.value).toEqual(firstRecall.value);
    expect(secondRecall.value).not.toBe(firstRecall.value);
    expect(peekThreadScroll(memory, key)).toEqual(firstRecall.value);
    expect(peekThreadScroll(memory, key)).not.toBe(peekThreadScroll(memory, key));
    expect(() => createSessionPresentationMemory(0)).toThrow(RangeError);
    expect(() => createSessionPresentationMemory(1.5)).toThrow(RangeError);
  });

  it("peeks without touching recency", () => {
    const thread = threadKey();
    const canvas = { workspaceId: "workspace-a", chatId: "chat-a" };
    const newerThread = threadKey({ branchId: "branch-b" });
    let memory = rememberThreadScroll(createSessionPresentationMemory(2), thread, {
      kind: "follow-latest",
    });
    memory = rememberCanvasViewport(memory, canvas, { x: 1, y: 2, zoom: 0.8 });

    expect(peekThreadScroll(memory, thread)).toEqual({ kind: "follow-latest" });
    memory = rememberThreadScroll(memory, newerThread, { kind: "follow-latest" });

    expect(peekThreadScroll(memory, thread)).toBeUndefined();
    expect(peekCanvasViewport(memory, canvas)).toEqual({ x: 1, y: 2, zoom: 0.8 });

    let canvasMemory = rememberCanvasViewport(createSessionPresentationMemory(2), canvas, {
      x: 1,
      y: 2,
      zoom: 0.8,
    });
    canvasMemory = rememberThreadScroll(canvasMemory, thread, { kind: "follow-latest" });
    expect(peekCanvasViewport(canvasMemory, canvas)).toEqual({ x: 1, y: 2, zoom: 0.8 });
    canvasMemory = rememberThreadScroll(canvasMemory, newerThread, { kind: "follow-latest" });

    expect(peekCanvasViewport(canvasMemory, canvas)).toBeUndefined();
    expect(peekThreadScroll(canvasMemory, thread)).toEqual({ kind: "follow-latest" });
  });

  it("enforces the default global capacity", () => {
    let memory = createSessionPresentationMemory();
    for (let index = 0; index <= 500; index += 1) {
      memory = rememberThreadScroll(memory, threadKey({ branchId: `branch-${index}` }), {
        kind: "follow-latest",
      });
    }

    expect(sessionPresentationMemorySize(memory)).toBe(500);
    expect(peekThreadScroll(memory, threadKey({ branchId: "branch-0" }))).toBeUndefined();
    expect(peekThreadScroll(memory, threadKey({ branchId: "branch-500" }))).toEqual({
      kind: "follow-latest",
    });
  });

  it("treats a missing recall as a no-op", () => {
    const memory = createSessionPresentationMemory();

    expect(recallThreadScroll(memory, threadKey({ branchId: "missing" })).memory).toBe(memory);
    expect(
      recallCanvasViewport(memory, { workspaceId: "workspace-a", chatId: "missing" }).memory,
    ).toBe(memory);
  });
});
