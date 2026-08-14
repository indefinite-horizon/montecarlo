/** Verifies sidebar chat grouping and last-user-message ordering. */

import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "../../apps/web/src/lib/conversation";
import {
  archiveSuccessor,
  organizeSidebarChats,
  type SidebarChat,
} from "../../apps/web/src/lib/sidebarChats";

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

describe("archiveSuccessor", () => {
  it("chooses the following chat from the archived chat's own section", () => {
    const chats = [
      chat("pinned-first", 100, { isPinned: true }),
      chat("project-first", 90, { projectId: "project-a" }),
      chat("loose-first", 80),
      chat("project-next", 70, { projectId: "project-a" }),
      chat("loose-next", 60),
      chat("pinned-next", 50, { isPinned: true, projectId: "project-b" }),
    ];

    expect(archiveSuccessor(chats, projects, "pinned-first")?.id).toBe("pinned-next");
    expect(archiveSuccessor(chats, projects, "project-first")?.id).toBe("project-next");
    expect(archiveSuccessor(chats, projects, "loose-first")?.id).toBe("loose-next");
  });

  it("falls back to the previous chat when archiving the last row in a section", () => {
    const chats = [
      chat("project-first", 20, { projectId: "project-a" }),
      chat("project-last", 10, { projectId: "project-a" }),
      chat("newest-elsewhere", 100),
    ];

    expect(archiveSuccessor(chats, projects, "project-last")?.id).toBe("project-first");
  });

  it("returns no successor when the section has no other chat", () => {
    expect(archiveSuccessor([chat("only-chat", 10)], projects, "only-chat")).toBeUndefined();
  });
});
