/** Bounded, in-memory presentation bookmarks for visited conversation surfaces. */

import { sharedConfig } from "../../../../lib/config";

export type ThreadScrollBookmark =
  | Readonly<{ kind: "follow-latest" }>
  | Readonly<{
      kind: "message-anchor";
      messageId: string;
      /** The message item's top edge relative to the viewport's top edge, in CSS pixels. */
      offset: number;
    }>;

export type CanvasViewportBookmark = Readonly<{
  x: number;
  y: number;
  zoom: number;
}>;

export type ThreadScrollMemoryKey = Readonly<{
  workspaceId: string;
  chatId: string;
  branchId: string;
  surface: "thread" | "canvas-card";
}>;

export type CanvasViewportMemoryKey = Readonly<{
  workspaceId: string;
  chatId: string;
}>;

type PresentationMemoryEntry =
  | Readonly<{ kind: "thread-scroll"; value: ThreadScrollBookmark }>
  | Readonly<{ kind: "canvas-viewport"; value: CanvasViewportBookmark }>;

export type SessionPresentationMemory = Readonly<{
  maxEntries: number;
  entries: ReadonlyMap<string, PresentationMemoryEntry>;
}>;

export type PresentationMemoryRecall<T> = Readonly<{
  memory: SessionPresentationMemory;
  value: T | undefined;
}>;

function threadScrollKey(key: ThreadScrollMemoryKey): string {
  return JSON.stringify(["thread-scroll", key.workspaceId, key.chatId, key.branchId, key.surface]);
}

function canvasViewportKey(key: CanvasViewportMemoryKey): string {
  return JSON.stringify(["canvas-viewport", key.workspaceId, key.chatId]);
}

function copyThreadScrollBookmark(bookmark: ThreadScrollBookmark): ThreadScrollBookmark {
  if (bookmark.kind === "follow-latest") return { kind: "follow-latest" };
  return {
    kind: "message-anchor",
    messageId: bookmark.messageId,
    offset: bookmark.offset,
  };
}

function copyCanvasViewportBookmark(bookmark: CanvasViewportBookmark): CanvasViewportBookmark {
  return { x: bookmark.x, y: bookmark.y, zoom: bookmark.zoom };
}

function rememberEntry(
  memory: SessionPresentationMemory,
  key: string,
  entry: PresentationMemoryEntry,
): SessionPresentationMemory {
  const entries = new Map(memory.entries);
  entries.delete(key);
  entries.set(key, entry);

  while (entries.size > memory.maxEntries) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) break;
    entries.delete(oldestKey);
  }

  return { maxEntries: memory.maxEntries, entries };
}

function recallEntry(
  memory: SessionPresentationMemory,
  key: string,
): Readonly<{
  memory: SessionPresentationMemory;
  entry: PresentationMemoryEntry | undefined;
}> {
  const entry = memory.entries.get(key);
  if (!entry) return { memory, entry: undefined };
  return { memory: rememberEntry(memory, key, entry), entry };
}

export function createSessionPresentationMemory(
  maxEntries = sharedConfig.presentationMemory.maxEntries,
): SessionPresentationMemory {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("Session presentation memory capacity must be a positive integer.");
  }
  return { maxEntries, entries: new Map() };
}

export function rememberThreadScroll(
  memory: SessionPresentationMemory,
  key: ThreadScrollMemoryKey,
  bookmark: ThreadScrollBookmark,
): SessionPresentationMemory {
  return rememberEntry(memory, threadScrollKey(key), {
    kind: "thread-scroll",
    value: copyThreadScrollBookmark(bookmark),
  });
}

export function peekThreadScroll(
  memory: SessionPresentationMemory,
  key: ThreadScrollMemoryKey,
): ThreadScrollBookmark | undefined {
  const entry = memory.entries.get(threadScrollKey(key));
  return entry?.kind === "thread-scroll" ? copyThreadScrollBookmark(entry.value) : undefined;
}

export function recallThreadScroll(
  memory: SessionPresentationMemory,
  key: ThreadScrollMemoryKey,
): PresentationMemoryRecall<ThreadScrollBookmark> {
  const recalled = recallEntry(memory, threadScrollKey(key));
  return {
    memory: recalled.memory,
    value:
      recalled.entry?.kind === "thread-scroll"
        ? copyThreadScrollBookmark(recalled.entry.value)
        : undefined,
  };
}

export function rememberCanvasViewport(
  memory: SessionPresentationMemory,
  key: CanvasViewportMemoryKey,
  bookmark: CanvasViewportBookmark,
): SessionPresentationMemory {
  return rememberEntry(memory, canvasViewportKey(key), {
    kind: "canvas-viewport",
    value: copyCanvasViewportBookmark(bookmark),
  });
}

export function peekCanvasViewport(
  memory: SessionPresentationMemory,
  key: CanvasViewportMemoryKey,
): CanvasViewportBookmark | undefined {
  const entry = memory.entries.get(canvasViewportKey(key));
  return entry?.kind === "canvas-viewport" ? copyCanvasViewportBookmark(entry.value) : undefined;
}

export function recallCanvasViewport(
  memory: SessionPresentationMemory,
  key: CanvasViewportMemoryKey,
): PresentationMemoryRecall<CanvasViewportBookmark> {
  const recalled = recallEntry(memory, canvasViewportKey(key));
  return {
    memory: recalled.memory,
    value:
      recalled.entry?.kind === "canvas-viewport"
        ? copyCanvasViewportBookmark(recalled.entry.value)
        : undefined,
  };
}

export function sessionPresentationMemorySize(memory: SessionPresentationMemory): number {
  return memory.entries.size;
}
