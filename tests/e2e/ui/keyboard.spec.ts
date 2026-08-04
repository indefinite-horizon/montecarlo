/** Keyboard reachability for primary composition and branching commands. */

import { expect, test } from "@playwright/test";
import { installRuntimeMock } from "../helpers/runtime";
import { createWorkspace, openFreshUser, userMessage } from "../helpers/workspace";

test.beforeEach(async ({ context, page }) => {
  await installRuntimeMock(context);
  await openFreshUser(page, "keyboard");
  await createWorkspace(page, `Keyboard workspace ${Date.now()}`);
});

test("message and prompt-branch flows are operable from the keyboard", async ({ page }) => {
  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  await composer.focus();
  await composer.fill("Keyboard message");
  await composer.press("Enter");
  await expect(userMessage(page, "Keyboard message")).toBeVisible();

  await page.getByRole("button", { name: "New branch" }).first().focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Branch this conversation" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("What should this branch explore?").fill("Keyboard branch");
  await dialog.getByRole("button", { name: "Create branch" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Keyboard branch", exact: true })).toBeVisible();
});

test("closing a modal restores focus to the invoking control", async () => {
  test.fixme(
    true,
    "Dialog focus trapping and restoration are not implemented in the current custom dialog primitives.",
  );
});
