/** Verifies sidebar chat grouping and last-user-message ordering. */

import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "../../apps/web/src/lib/conversation";
import { organizeSidebarChats, type SidebarChat } from "../../apps/web/src/lib/sidebarChats";

const projects: ProjectSummary[] = [
  { id: "project-a", name: "Project A", color: "blue" },
  { id: "project-b", name: "Project B", color: "green" },
];

function chat(
  id: string,
  lastUserMessageAt: number,
  options: Partial<Pick<SidebarChat, "isPinned" | "projectId" | "title" | "updatedAt">> = {},
): SidebarChat {
  return {
    id,
    title: options.title ?? id,
    updatedAt: options.updatedAt ?? lastUserMessageAt,
    lastUserMessageAt,
    branchCount: 1,
    isUnread: false,
    isPinned: options.isPinned ?? false,
    hasOngoingResponse: false,
    projectId: options.projectId,
  };
}

function ids(chats: readonly SidebarChat[]): string[] {
  return chats.map((item) => item.id);
}

describe("organizeSidebarChats", () => {
  it("groups pinned chats separately while retaining their project identity", () => {
    const pinnedProjectChat = chat("pinned-project", 30, {
      isPinned: true,
      projectId: "project-a",
    });
    const result = organizeSidebarChats(
      [
        pinnedProjectChat,
        chat("project-chat", 20, { projectId: "project-a" }),
        chat("projectless", 10),
      ],
      projects,
    );

    expect(ids(result.pinned)).toEqual(["pinned-project"]);
    expect(result.pinned[0]?.projectId).toBe("project-a");
    expect(ids(result.chatsByProjectId.get("project-a") ?? [])).toEqual(["project-chat"]);
    expect(ids(result.projectless)).toEqual(["projectless"]);
  });

  it("sorts pinned, projectless, and each project group independently", () => {
    const result = organizeSidebarChats(
      [
        chat("pinned-old", 10, { isPinned: true }),
        chat("project-a-old", 20, { projectId: "project-a" }),
        chat("loose-new", 60),
        chat("project-b-new", 80, { projectId: "project-b" }),
        chat("pinned-new", 70, { isPinned: true, projectId: "project-a" }),
        chat("project-a-new", 50, { projectId: "project-a" }),
        chat("loose-old", 30),
        chat("project-b-old", 40, { projectId: "project-b" }),
      ],
      projects,
    );

    expect(ids(result.pinned)).toEqual(["pinned-new", "pinned-old"]);
    expect(ids(result.projectless)).toEqual(["loose-new", "loose-old"]);
    expect(ids(result.chatsByProjectId.get("project-a") ?? [])).toEqual([
      "project-a-new",
      "project-a-old",
    ]);
    expect(ids(result.chatsByProjectId.get("project-b") ?? [])).toEqual([
      "project-b-new",
      "project-b-old",
    ]);
  });

  it("returns an unpinned chat to its original project without changing projectId", () => {
    const pinned = chat("chat-a", 10, { isPinned: true, projectId: "project-a" });
    expect(ids(organizeSidebarChats([pinned], projects).pinned)).toEqual(["chat-a"]);

    const unpinned = { ...pinned, isPinned: false };
    const result = organizeSidebarChats([unpinned], projects);

    expect(result.pinned).toEqual([]);
    expect(unpinned.projectId).toBe("project-a");
    expect(ids(result.chatsByProjectId.get("project-a") ?? [])).toEqual(["chat-a"]);
  });

  it("uses ascending chat id as a deterministic tie-break", () => {
    const result = organizeSidebarChats(
      [chat("chat-z", 10), chat("chat-a", 10), chat("chat-m", 10)],
      projects,
    );

    expect(ids(result.projectless)).toEqual(["chat-a", "chat-m", "chat-z"]);
  });

  it("does not reorder chats when unrelated metadata changes", () => {
    const older = chat("older", 10, { title: "Original", updatedAt: 10 });
    const newer = chat("newer", 20);
    const before = organizeSidebarChats([older, newer], projects);
    const after = organizeSidebarChats(
      [{ ...older, title: "Renamed", updatedAt: 10_000, isUnread: true }, newer],
      projects,
    );

    expect(ids(before.projectless)).toEqual(["newer", "older"]);
    expect(ids(after.projectless)).toEqual(["newer", "older"]);
  });
});
