/** Fresh local anonymous bootstrap and its first durable workspace journey. */

import { expect, test } from "@playwright/test";
import { installRuntimeMock } from "../helpers/runtime";
import {
  assistantMessage,
  createChat,
  createProject,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

test.beforeEach(async ({ context }) => {
  await installRuntimeMock(context);
});

test("local anonymous startup supports the durable workspace journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-app")).toBeVisible();

  const workspaceSelector = page.getByTestId("workspace-selector");
  await workspaceSelector.click();
  const workspaceMenu = page.getByRole("menu", { name: "Workspaces" });
  await expect(workspaceMenu.locator('[role="menuitem"][aria-current="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");

  await expect(page.locator('[data-testid="chat-row"][aria-current="page"]')).toBeVisible();
  await expect(page.getByTestId("chat-breadcrumb-title")).not.toHaveText("");
  await expect
    .poll(() => {
      const search = new URL(page.url()).searchParams;
      return [
        Boolean(search.get("workspace")),
        Boolean(search.get("chat")),
        Boolean(search.get("branch")),
        search.get("view"),
      ];
    })
    .toEqual([true, true, true, "thread"]);

  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  await expect(composer).toBeEnabled();
  await composer.fill("Local bootstrap is ready");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "New branch" }).first()).toBeEnabled();

  const projectName = `Local project ${Date.now()}`;
  await createProject(page, projectName);
  await createChat(page, projectName);
  await sendMessage(page, "Local bootstrap is ready", "Stub response: Local bootstrap is ready");

  await page.reload();
  await expect(page.getByTestId("workspace-app")).toBeVisible();
  const projectSection = page
    .getByRole("navigation", { name: "Projects and chats" })
    .locator("section")
    .filter({ hasText: projectName });
  await expect(projectSection.getByTestId("chat-row")).toHaveCount(1);
  await expect(userMessage(page, "Local bootstrap is ready")).toBeVisible();
  await expect(assistantMessage(page, "Stub response: Local bootstrap is ready")).toBeVisible();
});
