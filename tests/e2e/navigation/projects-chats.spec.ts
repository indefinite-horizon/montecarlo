/** Project grouping, unfiled chats, switching, and search. */

import { expect, type Page, test } from "@playwright/test";
import { installRuntimeMock } from "../helpers/runtime";
import {
  activeChatRow,
  createChat,
  createProject,
  createPromptBranch,
  createWorkspace,
  openFreshUser,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

const archiveShortcutKeys = process.platform === "darwin" ? "Meta+Shift+A" : "Control+Shift+A";

test.beforeEach(async ({ context, page }) => {
  await installRuntimeMock(context);
  await openFreshUser(page, "projects-chats");
});

function projectSection(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Projects and chats" })
    .getByTestId("project-section")
    .filter({ hasText: name });
}

function unfiledSection(page: Page) {
  return page.getByTestId("projectless-chats");
}

function pinnedSection(page: Page) {
  return page.getByTestId("pinned-chats-section");
}

function chatRow(page: Page, title: string) {
  return page.getByTestId("chat-row").filter({ hasText: title });
}

function chatRowByPublicId(page: Page, publicId: string) {
  return page.locator(`[data-testid="chat-row"][data-chat-id="${publicId}"]`);
}

async function openChatContextMenu(page: Page, title: string) {
  const menu = page.getByRole("menu", { name: `Chat actions — ${title}` });
  await expect(async () => {
    await chatRow(page, title).click({ button: "right" });
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  return menu;
}

async function expectCompleteWorkspaceUrl(page: Page) {
  await expect
    .poll(
      () => {
        const search = new URL(page.url()).searchParams;
        return [
          Boolean(search.get("workspace")),
          Boolean(search.get("chat")),
          Boolean(search.get("branch")),
          search.get("view"),
        ];
      },
      { timeout: 15_000 },
    )
    .toEqual([true, true, true, "thread"]);
}

test("creates a project and a persistent chat inside it", async ({ page }) => {
  await createWorkspace(page, "Organized workspace");
  await createProject(page, "Research");
  const section = projectSection(page, "Research");
  const newProjectButton = page.getByRole("button", { name: "New project", exact: true });
  const newProjectChatButton = section.getByRole("button", {
    name: "New chat — Research",
    exact: true,
  });
  await expect(newProjectChatButton).toBeVisible();
  const chatTitle = await createChat(page, "Research");
  await expect(section.getByRole("button", { name: chatTitle, exact: true })).toBeVisible();
  const row = chatRow(page, chatTitle);
  await row.hover();
  const archiveButton = row.getByRole("button", { name: `Archive ${chatTitle}`, exact: true });
  await expect(archiveButton).toBeVisible();
  const [newProjectBox, newChatBox, archiveBox] = await Promise.all([
    newProjectButton.boundingBox(),
    newProjectChatButton.boundingBox(),
    archiveButton.boundingBox(),
  ]);
  if (!newProjectBox || !newChatBox || !archiveBox) {
    throw new Error("Could not measure sidebar action buttons.");
  }
  const actionCenters = [newProjectBox, newChatBox, archiveBox].map((box) => box.x + box.width / 2);
  expect(Math.max(...actionCenters) - Math.min(...actionCenters)).toBeLessThan(1);
  await expect(page.getByTestId("chat-breadcrumb-project")).toHaveText("Research");
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(chatTitle);
  const breadcrumbTypography = await Promise.all(
    ["chat-breadcrumb-project", "chat-breadcrumb-title"].map((testId) =>
      page.getByTestId(testId).evaluate((element) => {
        const style = getComputedStyle(element);
        return { fontFamily: style.fontFamily, fontSize: style.fontSize };
      }),
    ),
  );
  expect(breadcrumbTypography[0]).toEqual(breadcrumbTypography[1]);

  await page.reload();
  await expect(
    projectSection(page, "Research").getByRole("button", { name: chatTitle, exact: true }),
  ).toBeVisible();
});

test("creates an unfiled chat that remains outside every project", async ({ page }) => {
  await createWorkspace(page, "Unfiled workspace");
  await createProject(page, "Filed project");
  await createChat(page);
  await expect(unfiledSection(page).getByTestId("chat-row")).toHaveCount(2);
  await expect(projectSection(page, "Filed project").getByTestId("chat-row")).toHaveCount(0);
  await expect(page.getByText("Without a project", { exact: true })).toHaveCount(0);
  const [projectlessBox, projectsHeadingBox, projectBox] = await Promise.all([
    unfiledSection(page).boundingBox(),
    page.getByRole("heading", { name: "Projects", exact: true }).boundingBox(),
    projectSection(page, "Filed project").boundingBox(),
  ]);
  if (!projectlessBox || !projectsHeadingBox || !projectBox) {
    throw new Error("Could not measure sidebar groups.");
  }
  expect(projectlessBox.y).toBeLessThan(projectsHeadingBox.y);
  expect(projectlessBox.y).toBeLessThan(projectBox.y);
});

test("restores each chat's last branch and conversation view", async ({ page }) => {
  const firstTitle = await createWorkspace(page, "Remembered chat locations");
  await createPromptBranch(page, "Remember this branch");
  const firstChatId = await chatRow(page, firstTitle).getAttribute("data-chat-id");
  const firstBranchId = new URL(page.url()).searchParams.get("branch");
  if (!firstChatId || !firstBranchId) throw new Error("The first chat route was incomplete.");

  await page.getByRole("button", { name: "Canvas view", exact: true }).click();
  const secondTitle = await createChat(page);
  const secondChatId = await chatRow(page, secondTitle).getAttribute("data-chat-id");
  const secondBranchId = new URL(page.url()).searchParams.get("branch");
  if (!secondChatId || !secondBranchId) throw new Error("The second chat route was incomplete.");
  await page.getByRole("button", { name: "Thread view", exact: true }).click();

  await chatRow(page, firstTitle).getByRole("button", { name: firstTitle, exact: true }).click();
  await expect
    .poll(() => {
      const search = new URL(page.url()).searchParams;
      return [search.get("chat"), search.get("branch"), search.get("view")];
    })
    .toEqual([firstChatId, firstBranchId, "canvas"]);

  await chatRow(page, secondTitle).getByRole("button", { name: secondTitle, exact: true }).click();
  await expect
    .poll(() => {
      const search = new URL(page.url()).searchParams;
      return [search.get("chat"), search.get("branch"), search.get("view")];
    })
    .toEqual([secondChatId, secondBranchId, "thread"]);
});

test("paginates aligned chat groups and toggles project contents", async ({ page }) => {
  await createWorkspace(page, "Paginated workspace");
  for (let index = 0; index < 5; index += 1) await createChat(page);

  const projectlessRows = unfiledSection(page).getByTestId("chat-row");
  const projectlessMore = unfiledSection(page).getByRole("button", {
    name: "Show more chats",
  });
  await expect(projectlessRows).toHaveCount(5);
  await projectlessMore.click();
  await expect(projectlessRows).toHaveCount(6);
  await expect(projectlessMore).toHaveCount(0);
  await expect(projectlessRows.nth(5).getByRole("button").first()).toBeFocused();

  await createProject(page, "Paginated project");
  for (let index = 0; index < 11; index += 1) {
    await createChat(page, "Paginated project");
  }

  const section = projectSection(page, "Paginated project");
  const projectRows = section.getByTestId("chat-row");
  const projectToggle = section.getByTestId("project-toggle");
  const projectContentId = await projectToggle.getAttribute("aria-controls");
  if (!projectContentId) throw new Error("The project toggle was missing aria-controls.");
  const projectContent = page.locator(`[id=${JSON.stringify(projectContentId)}]`);
  let projectMore = section.getByRole("button", {
    name: "Show more chats in Paginated project",
  });
  await expect(projectRows).toHaveCount(5);
  await expect(projectToggle).toHaveAttribute("aria-expanded", "true");
  await expect(projectContent).toBeVisible();

  const [projectlessTitleBox, projectTitleBox] = await Promise.all([
    projectlessRows.first().getByTestId("chat-title").boundingBox(),
    projectRows.first().getByTestId("chat-title").boundingBox(),
  ]);
  if (!projectlessTitleBox || !projectTitleBox) throw new Error("Could not measure chat titles.");
  expect(Math.abs(projectlessTitleBox.x - projectTitleBox.x)).toBeLessThan(1);

  await projectMore.click();
  await expect(projectRows).toHaveCount(10);
  await projectToggle.click();
  await expect(projectToggle).toHaveAttribute("aria-expanded", "false");
  await expect(projectContent).toBeHidden();
  await expect(
    section.getByRole("button", { name: "New chat — Paginated project", exact: true }),
  ).toBeVisible();
  await expect(projectRows.first()).toBeHidden();
  await expect(projectMore).toBeHidden();

  await projectToggle.press("Enter");
  await expect(projectToggle).toHaveAttribute("aria-expanded", "true");
  await expect(projectContent).toBeVisible();
  await expect(projectRows.nth(9)).toBeVisible();
  projectMore = section.getByRole("button", {
    name: "Show more chats in Paginated project",
  });
  await projectMore.click();
  await expect(projectRows).toHaveCount(11);
  await expect(projectMore).toHaveCount(0);
  await expect(projectRows.nth(10).getByRole("button").first()).toBeFocused();
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

  await unfiledSection(page).getByTestId("chat-row").first().click();
  await sendMessage(
    page,
    "Message only in unfiled chat",
    "Stub response: Message only in unfiled chat",
  );
  await expect(userMessage(page, "Message only in project chat")).toHaveCount(0);

  await projectSection(page, "Chat one project")
    .getByRole("button", { name: "Message only in project chat", exact: true })
    .click();
  await expect(userMessage(page, "Message only in project chat")).toBeVisible();
  await expect(userMessage(page, "Message only in unfiled chat")).toHaveCount(0);
});

test("archives a chat from its sidebar icon and keeps it hidden after reload", async ({ page }) => {
  const archivedTitle = await createWorkspace(page, "Archive workspace");
  const archivedRow = chatRow(page, archivedTitle);
  const archivedPublicId = await archivedRow.getAttribute("data-chat-id");
  if (!archivedPublicId) throw new Error("The chat row was missing its public ID.");
  await createChat(page);

  await archivedRow.hover();
  await archivedRow.getByRole("button", { name: `Archive ${archivedTitle}`, exact: true }).click();
  await expect(page.locator(`[data-chat-id="${archivedPublicId}"]`)).toHaveCount(0);

  await page.reload();
  await expect(page.locator(`[data-chat-id="${archivedPublicId}"]`)).toHaveCount(0);
});

test("archiving the active chat advances within its sidebar section", async ({ page }) => {
  const oldestTitle = await createWorkspace(page, "Archive successor workspace");
  const middleTitle = await createChat(page);
  await createChat(page);
  const oldestPublicId = await chatRow(page, oldestTitle).getAttribute("data-chat-id");
  if (!oldestPublicId) throw new Error("The successor chat was missing its public ID.");

  const middleRow = chatRow(page, middleTitle);
  await middleRow.getByRole("button", { name: middleTitle, exact: true }).click();
  await middleRow.hover();
  await middleRow.getByRole("button", { name: `Archive ${middleTitle}`, exact: true }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get("chat")).toBe(oldestPublicId);
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(oldestTitle);
});

test("row hotkeys are menu-scoped while the archive shortcut remains global", async ({ page }) => {
  await createWorkspace(page, "Scoped chat actions workspace");
  await sendMessage(page, "Scoped menu hotkeys", "Stub response: Scoped menu hotkeys");
  await expectCompleteWorkspaceUrl(page);
  const archivedPublicId = await activeChatRow(page).getAttribute("data-chat-id");
  if (!archivedPublicId) throw new Error("The active chat was missing its public ID.");
  await expect.poll(() => new URL(page.url()).searchParams.get("chat")).toBe(archivedPublicId);
  const archivedUrl = page.url();
  const scopedRow = chatRowByPublicId(page, archivedPublicId);

  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  await composer.focus();
  await page.keyboard.press("r");
  await page.keyboard.press("p");
  await expect(scopedRow).toHaveAttribute("data-pinned", "false");
  await expect(scopedRow).toHaveAttribute("data-unread", "false");
  await expect(page).toHaveURL(archivedUrl);

  await scopedRow.click({ button: "right" });
  const menu = page.getByTestId("chat-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
  await expect(menu.getByRole("menuitem", { name: /Mark as unread/u })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Pin P$/u })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy link", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Archive chat/u })).toBeVisible();
  await expect(menu.getByText("Set status", { exact: true })).toHaveCount(0);
  await page.keyboard.press("p");
  await expect(pinnedSection(page)).toBeVisible();
  await expect(scopedRow).toHaveAttribute("data-pinned", "true");

  await scopedRow.click({ button: "right" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("r");
  await expect(scopedRow).toHaveAttribute("data-unread", "true");
  await expect(scopedRow.getByTestId("chat-title")).toHaveClass(/font-semibold/u);
  await expect(scopedRow.getByTestId("chat-title")).toHaveClass(/text-foreground/u);

  await composer.focus();
  await page.keyboard.press(archiveShortcutKeys);
  await expect.poll(() => new URL(page.url()).searchParams.get("chat")).not.toBe(archivedPublicId);
  await expect(page.locator(`[data-chat-id="${archivedPublicId}"]`)).toHaveCount(0);
  await expectCompleteWorkspaceUrl(page);

  await page.goto(archivedUrl);
  await expect.poll(() => new URL(page.url()).searchParams.get("chat")).not.toBe(archivedPublicId);
  await expect(page.getByTestId("chat-breadcrumb-title")).toBeVisible();
  await expect(page.getByPlaceholder("Ask a follow-up or start a new direction…")).toBeEnabled();
});

test("pinning persists and unpinning restores a chat to its project", async ({ page }) => {
  await createWorkspace(page, "Pinned workspace");
  await createProject(page, "Pinned project");
  const title = await createChat(page, "Pinned project");

  let menu = await openChatContextMenu(page, title);
  await menu.getByRole("menuitem", { name: /^Pin P$/u }).click();
  await expect(pinnedSection(page).getByTestId("chat-row")).toHaveCount(1);
  await expect(projectSection(page, "Pinned project").getByTestId("chat-row")).toHaveCount(0);

  await page.reload();
  await expect(pinnedSection(page).getByRole("button", { name: title, exact: true })).toBeVisible();
  await expect(projectSection(page, "Pinned project").getByTestId("chat-row")).toHaveCount(0);

  menu = await openChatContextMenu(page, title);
  await menu.getByRole("menuitem", { name: /^Unpin P$/u }).click();
  await expect(pinnedSection(page)).toHaveCount(0);
  await expect(
    projectSection(page, "Pinned project").getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
});

test("rename and copy link target the context-clicked chat", async ({ context, page }) => {
  const targetTitle = await createWorkspace(page, "Targeted chat actions workspace");
  await createProject(page, "Active project");
  const activeTitle = await createChat(page, "Active project");
  const targetPublicId = await chatRow(page, targetTitle).getAttribute("data-chat-id");
  if (!targetPublicId) throw new Error("The target chat was missing its public ID.");

  let menu = await openChatContextMenu(page, targetTitle);
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const renameDialog = page.getByRole("dialog", { name: "Rename chat" });
  await renameDialog.getByLabel("Chat name").fill("Renamed target chat");
  await renameDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(chatRow(page, "Renamed target chat")).toBeVisible();
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(activeTitle);

  await page.reload();
  await expect(chatRow(page, "Renamed target chat")).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  menu = await openChatContextMenu(page, "Renamed target chat");
  await menu.getByRole("menuitem", { name: "Copy link", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe("");
  const copiedUrl = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  const currentUrl = new URL(page.url());
  expect(copiedUrl.searchParams.get("workspace")).toBe(currentUrl.searchParams.get("workspace"));
  expect(copiedUrl.searchParams.get("chat")).toBe(targetPublicId);
  expect(copiedUrl.searchParams.get("chat")).not.toBe(currentUrl.searchParams.get("chat"));
  expect(copiedUrl.searchParams.get("branch")).toBeTruthy();
  expect(copiedUrl.searchParams.get("view")).toBe("thread");
});

test("project and pinned chats stay sorted by last user send", async ({ page }) => {
  await createWorkspace(page, "Activity order workspace");
  await createProject(page, "Activity project");
  await createChat(page, "Activity project");
  const olderPublicId = await activeChatRow(page).getAttribute("data-chat-id");
  if (!olderPublicId) throw new Error("The older chat was missing its public ID.");

  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  await composer.fill("[e2e:slow] Older project activity");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(userMessage(page, "[e2e:slow] Older project activity")).toBeVisible();

  await createChat(page, "Activity project");
  const newerPublicId = await activeChatRow(page).getAttribute("data-chat-id");
  if (!newerPublicId) throw new Error("The newer chat was missing its public ID.");
  await sendMessage(page, "Newer project activity", "Stub response: Newer project activity");
  await expect(page.locator(`[data-chat-id="${olderPublicId}"]`)).toHaveAttribute(
    "data-ongoing-response",
    "false",
    { timeout: 15_000 },
  );

  const projectRows = projectSection(page, "Activity project").getByTestId("chat-row");
  await expect
    .poll(() =>
      projectRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-chat-id"))),
    )
    .toEqual([newerPublicId, olderPublicId]);

  for (const publicId of [olderPublicId, newerPublicId]) {
    await page.locator(`[data-chat-id="${publicId}"]`).click({ button: "right" });
    await page
      .getByTestId("chat-context-menu")
      .getByRole("menuitem", { name: /^Pin P$/u })
      .click();
  }
  const pinnedRows = pinnedSection(page).getByTestId("chat-row");
  await expect
    .poll(() =>
      pinnedRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-chat-id"))),
    )
    .toEqual([newerPublicId, olderPublicId]);

  await page.locator(`[data-chat-id="${olderPublicId}"]`).click({ button: "right" });
  await page.getByTestId("chat-context-menu").getByRole("menuitem", { name: "Rename" }).click();
  const renameDialog = page.getByRole("dialog", { name: "Rename chat" });
  await renameDialog.getByLabel("Chat name").fill("Renamed older activity");
  await renameDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() =>
      pinnedRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-chat-id"))),
    )
    .toEqual([newerPublicId, olderPublicId]);
});

test("back and forward restore fully specified chat locations", async ({ page }) => {
  const unfiledTitle = await createWorkspace(page, "History workspace");
  await createProject(page, "History project");
  const projectTitle = await createChat(page, "History project");
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(projectTitle);
  await expectCompleteWorkspaceUrl(page);
  const projectUrl = page.url();

  await unfiledSection(page).getByRole("button", { name: unfiledTitle, exact: true }).click();
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(unfiledTitle);
  await expect(page.getByTestId("chat-breadcrumb-project")).toHaveCount(0);
  await expectCompleteWorkspaceUrl(page);
  await expect(page.getByRole("button", { name: "Back" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Forward" })).toBeDisabled();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(projectTitle);
  await expect(page.getByTestId("chat-breadcrumb-project")).toHaveText("History project");
  await expect(page.getByRole("button", { name: "Forward" })).toBeEnabled();

  await page.getByRole("button", { name: "Forward" }).click();
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(unfiledTitle);
  await expect(page.getByTestId("chat-breadcrumb-project")).toHaveCount(0);
  await expectCompleteWorkspaceUrl(page);
  await expect(page.getByRole("button", { name: "Forward" })).toBeDisabled();
});

test("app navigation controls exclude an external redirect round trip", async ({ page }) => {
  await createWorkspace(page, "External redirect workspace");
  await expectCompleteWorkspaceUrl(page);
  const appUrl = page.url();
  await page.route("https://oauth.example.test/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<a href="${appUrl}">Return to Monte Carlo</a>`,
    });
  });

  await page.goto("https://oauth.example.test/authorize");
  await page.getByRole("link", { name: "Return to Monte Carlo" }).click({ noWaitAfter: true });
  await expect(page.getByTestId("workspace-app")).toBeVisible();
  await expectCompleteWorkspaceUrl(page);
  const appOrigin = new URL(appUrl).origin;
  await createChat(page);
  await createChat(page);

  const back = page.getByRole("button", { name: "Back" });
  const forward = page.getByRole("button", { name: "Forward" });
  let backSteps = 0;
  for (; backSteps < 20 && (await back.isEnabled()); backSteps += 1) {
    await back.click();
    await expect(page.getByTestId("workspace-app")).toBeVisible();
    await expectCompleteWorkspaceUrl(page);
    expect(new URL(page.url()).origin).toBe(appOrigin);
  }
  expect(backSteps).toBeGreaterThan(0);
  await expect(back).toBeDisabled();

  // A forced DOM click guards the boundary independently of disabled-button styling.
  const oldestAppUrl = page.url();
  await back.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page).toHaveURL(oldestAppUrl);

  let forwardSteps = 0;
  for (; forwardSteps < 20 && (await forward.isEnabled()); forwardSteps += 1) {
    await forward.click();
    await expect(page.getByTestId("workspace-app")).toBeVisible();
    await expectCompleteWorkspaceUrl(page);
    expect(new URL(page.url()).origin).toBe(appOrigin);
  }
  expect(forwardSteps).toBeGreaterThan(0);
  await expect(forward).toBeDisabled();
});

test("the unified command palette searches and switches chats", async ({ page }) => {
  await createWorkspace(page, "Search workspace");
  await sendMessage(page, "Palette target chat", "Stub response: Palette target chat");
  await createChat(page);

  await page.getByRole("button", { name: "Search commands" }).click();
  const palette = page.getByTestId("command-palette-dialog");
  const search = page.getByTestId("command-palette-input");
  await expect(palette).toBeVisible();
  await search.fill("pAlEtTe TaRgEt ChAt");
  const chatResult = page.getByRole("option", { name: "Open chat: Palette target chat" });
  await expect(chatResult).toBeVisible();

  await search.fill("missing chat");
  await expect(page.getByText("No matching commands", { exact: true })).toBeVisible();

  await search.fill("");
  await expect(page.getByTestId("command-new-chat")).toBeVisible();
  await search.fill("pAlEtTe TaRgEt ChAt");
  await chatResult.click();

  await expect(palette).toHaveCount(0);
  await expect(userMessage(page, "Palette target chat")).toBeVisible();
});
