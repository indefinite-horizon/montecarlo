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

async function expectCompleteWorkspaceUrl(page: import("@playwright/test").Page) {
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
  const chatTitle = await createChat(page, "Research");
  await expect(
    projectSection(page, "Research").getByRole("button", { name: chatTitle, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("chat-breadcrumb-project")).toHaveText("Research");
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(chatTitle);

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

test("app navigation controls exclude an external redirect round trip", async ({
  page,
}, testInfo) => {
  const appUrl = new URL("/", String(testInfo.project.use.baseURL)).href;
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
