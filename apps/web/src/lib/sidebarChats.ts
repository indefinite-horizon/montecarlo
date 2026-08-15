/** Pure organization and ordering for chats rendered in the workspace sidebar. */

import type { ChatSummary, ProjectSummary } from "./conversation";

export type SidebarChat = ChatSummary & {
  isPinned: boolean;
  lastUserMessageAt: number;
};

export type SidebarChatOrganization = Readonly<{
  pinned: SidebarChat[];
  projectless: SidebarChat[];
  chatsByProjectId: ReadonlyMap<string, SidebarChat[]>;
}>;

function compareSidebarChats(left: SidebarChat, right: SidebarChat): number {
  if (left.lastUserMessageAt !== right.lastUserMessageAt) {
    return right.lastUserMessageAt - left.lastUserMessageAt;
  }
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function sortSidebarChats(chats: SidebarChat[]): SidebarChat[] {
  return chats.sort(compareSidebarChats);
}

export function organizeSidebarChats(
  chats: readonly SidebarChat[],
  projects: readonly ProjectSummary[],
): SidebarChatOrganization {
  const pinned: SidebarChat[] = [];
  const projectless: SidebarChat[] = [];
  const chatsByProjectId = new Map<string, SidebarChat[]>(
    projects.map((project) => [project.id, []]),
  );

  for (const chat of chats) {
    if (chat.isPinned) {
      pinned.push(chat);
      continue;
    }
    if (!chat.projectId) {
      projectless.push(chat);
      continue;
    }
    const projectChats = chatsByProjectId.get(chat.projectId) ?? [];
    projectChats.push(chat);
    chatsByProjectId.set(chat.projectId, projectChats);
  }

  for (const projectChats of chatsByProjectId.values()) sortSidebarChats(projectChats);

  return {
    pinned: sortSidebarChats(pinned),
    projectless: sortSidebarChats(projectless),
    chatsByProjectId,
  };
}

/** Chooses the row that should receive focus after a chat disappears from its section. */
export function archiveSuccessor(
  chats: readonly SidebarChat[],
  projects: readonly ProjectSummary[],
  archivedChatId: string,
): SidebarChat | undefined {
  const archivedChat = chats.find((chat) => chat.id === archivedChatId);
  if (!archivedChat) return undefined;

  const { pinned, projectless, chatsByProjectId } = organizeSidebarChats(chats, projects);
  const section = archivedChat.isPinned
    ? pinned
    : archivedChat.projectId
      ? (chatsByProjectId.get(archivedChat.projectId) ?? [])
      : projectless;
  const archivedIndex = section.findIndex((chat) => chat.id === archivedChatId);
  if (archivedIndex < 0) return undefined;

  return section[archivedIndex + 1] ?? section[archivedIndex - 1];
}
