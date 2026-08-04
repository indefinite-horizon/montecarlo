/** Project grouping, unfiled chats, switching, and search. */

import { expect, test } from "@playwright/test";
import { installRuntimeMock } from "../helpers/runtime";
import {
  createChat,
  createProject,
  createWorkspace,
  openFreshUser,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

test.beforeEach(async ({ context, page }) => {
  await installRuntimeMock(context);
  await openFreshUser(page, "projects-chats");
});

function projectSection(page: import("@playwright/test").Page, name: string) {
  return page
    .getByRole("navigation", { name: "Projects and chats" })
    .locator("section")
    .filter({ hasText: name });
}

function unfiledSection(page: import("@playwright/test").Page) {
  return page
    .getByRole("navigation", { name: "Projects and chats" })
    .locator("section")
    .filter({ hasText: "Without a project" });
}

test("creates a project and a persistent chat inside it", async ({ page }) => {
  await createWorkspace(page, "Organized workspace");
  await createProject(page, "Research");
  await createChat(page, "Research");
  await expect(
    projectSection(page, "Research").getByRole("button", { name: "New conversation" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    projectSection(page, "Research").getByRole("button", { name: "New conversation" }),
  ).toBeVisible();
});

test("creates an unfiled chat that remains outside every project", async ({ page }) => {
  await createWorkspace(page, "Unfiled workspace");
  await createProject(page, "Filed project");
  await createChat(page);
  await expect(unfiledSection(page).getByRole("button", { name: "New conversation" })).toHaveCount(
    2,
  );
  await expect(
    projectSection(page, "Filed project").getByRole("button", { name: "New conversation" }),
  ).toHaveCount(0);
});

test("switching chats restores independent conversations", async ({ page }) => {
  await createWorkspace(page, "Switching workspace");
  await createProject(page, "Chat one project");
  await createChat(page, "Chat one project");
  await sendMessage(
    page,
    "Message only in project chat",
    "Stub response: Message only in project chat",
  );

  await unfiledSection(page).getByRole("button", { name: "New conversation" }).click();
  await sendMessage(
    page,
    "Message only in unfiled chat",
    "Stub response: Message only in unfiled chat",
  );
  await expect(userMessage(page, "Message only in project chat")).toHaveCount(0);

  await projectSection(page, "Chat one project")
    .getByRole("button", { name: "New conversation" })
    .click();
  await expect(userMessage(page, "Message only in project chat")).toBeVisible();
  await expect(userMessage(page, "Message only in unfiled chat")).toHaveCount(0);
});

test("chat search is case-insensitive and clearing it restores all groups", async ({ page }) => {
  await createWorkspace(page, "Search workspace");
  await createChat(page);
  await page.getByRole("button", { name: "Search chats" }).click();
  const search = page.getByRole("textbox", { name: "Search chats" });
  const conversationRows = page
    .getByRole("navigation", { name: "Projects and chats" })
    .getByRole("button", { name: "New conversation" });
  await search.fill("nEw CoNvErSaTiOn");
  await expect(conversationRows).toHaveCount(2);
  await search.fill("missing chat");
  await expect(conversationRows).toHaveCount(0);

  await page.getByRole("button", { name: "Search chats" }).first().click();
  await expect(conversationRows).toHaveCount(2);
});
