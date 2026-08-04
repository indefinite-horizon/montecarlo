/** Mobile sheets, desktop panes, overflow, and semantic active states. */

import { expect, test } from "@playwright/test";
import { installRuntimeMock } from "../helpers/runtime";
import { createPromptBranch, createWorkspace, openFreshUser } from "../helpers/workspace";

test.beforeEach(async ({ context, page }) => {
  await installRuntimeMock(context);
  await openFreshUser(page, "responsive");
  await createWorkspace(page, `Responsive workspace ${Date.now()}`);
});

test("mobile prioritizes transcript and closes navigation after chat selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("workspace-app")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Projects and chats" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await page.getByRole("button", { name: "New conversation", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Projects and chats" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Ask a follow-up or start a new direction…")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("mobile branch map behaves as a dismissible sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Branch map" }).click();
  await expect(page.getByRole("heading", { name: "Branch map" })).toBeVisible();
  await page
    .getByRole("complementary")
    .last()
    .getByRole("button", { name: "Close branch map" })
    .click();
  await expect(page.getByRole("heading", { name: "Branch map" })).toHaveCount(0);
});

test("desktop renders three panes and preserves state while panes collapse", async ({ page }) => {
  await createPromptBranch(page, "Responsive branch");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("navigation", { name: "Projects and chats" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Branch map" })).toBeVisible();
  await page.getByRole("button", { name: "Responsive branch", exact: true }).click();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page
    .getByRole("complementary")
    .last()
    .getByRole("button", { name: "Close branch map" })
    .click();
  await expect(page.getByRole("heading", { name: "Responsive branch" })).toBeVisible();
});

test("active branch has semantic state in addition to visual styling", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const active = page.getByRole("complementary").last().locator('button[aria-current="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveClass(/border-primary/u);
  await expect(page.getByRole("button", { name: "Open settings" })).toHaveAccessibleName(
    "Open settings",
  );
  await expect(
    page.getByRole("complementary").last().getByRole("button", { name: "Close branch map" }),
  ).toHaveAccessibleName("Close branch map");
});
