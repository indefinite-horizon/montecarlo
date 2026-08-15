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
  await page.locator('[data-testid="chat-row"][aria-current="page"]').click();
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
  const responsiveBranch = page
    .locator('[data-testid="branch-map-row"][data-branch-depth="1"]')
    .filter({ hasText: "Responsive branch" });
  await responsiveBranch.click();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page
    .getByRole("complementary")
    .last()
    .getByRole("button", { name: "Close branch map" })
    .click();
  await page.getByRole("button", { name: "Branch map" }).click();
  await expect(responsiveBranch).toHaveClass(/border-primary/u);
});

test("desktop sidebar can be resized within bounds and remembers its width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sidebar = page.getByRole("complementary", { name: "Projects and chats" });
  const resizeHandle = page.getByRole("separator", { name: "Resize sidebar" });

  await expect(sidebar).toHaveCSS("width", "264px");
  const handleBox = await resizeHandle.boundingBox();
  if (!handleBox) throw new Error("Sidebar resize handle is not visible");
  const handleCenter = handleBox.x + handleBox.width / 2;
  await page.mouse.move(handleCenter, handleBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(handleCenter + 76, handleBox.y + 100);
  await page.mouse.up();
  await expect(sidebar).toHaveCSS("width", "340px");

  await resizeHandle.press("End");
  await expect(sidebar).toHaveCSS("width", "420px");
  await resizeHandle.press("ArrowRight");
  await expect(sidebar).toHaveCSS("width", "420px");
  await page.reload();
  await expect(sidebar).toHaveCSS("width", "420px");

  await resizeHandle.press("Home");
  await expect(sidebar).toHaveCSS("width", "224px");
  await resizeHandle.press("ArrowLeft");
  await expect(sidebar).toHaveCSS("width", "224px");
});

test("desktop branch map can be resized within bounds and remembers its width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const branchMap = page.getByRole("complementary", { name: "Branch map" });
  const resizeHandle = page.getByRole("separator", { name: "Resize branch map" });

  await expect(branchMap).toHaveCSS("width", "304px");
  const handleBox = await resizeHandle.boundingBox();
  if (!handleBox) throw new Error("Branch map resize handle is not visible");
  const handleCenter = handleBox.x + handleBox.width / 2;
  await page.mouse.move(handleCenter, handleBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(handleCenter - 96, handleBox.y + 100);
  await page.mouse.up();
  await expect(branchMap).toHaveCSS("width", "400px");

  await resizeHandle.press("End");
  await expect(branchMap).toHaveCSS("width", "480px");
  await resizeHandle.press("ArrowLeft");
  await expect(branchMap).toHaveCSS("width", "480px");
  await page.reload();
  await expect(branchMap).toHaveCSS("width", "480px");

  await resizeHandle.press("Home");
  await expect(branchMap).toHaveCSS("width", "256px");
  await resizeHandle.press("ArrowRight");
  await expect(branchMap).toHaveCSS("width", "256px");
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

test("branch map reveals branch creation on row hover and focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const branchMap = page.getByRole("complementary", { name: "Branch map" });
  const branchMapTitle = branchMap.getByRole("heading", { name: "Branch map" });
  const branchRow = branchMap.getByTestId("branch-map-row").first();
  const branchName = branchRow.getByTestId("branch-map-title");
  const createBranch = branchMap.getByTestId("branch-map-create").first();
  const workspaceTitle = page.getByTestId("chat-breadcrumb-title");

  await expect(branchMapTitle).toHaveCSS("font-size", "14px");
  await expect(branchName).toHaveCSS("font-size", "14px");
  await expect(workspaceTitle).toHaveCSS("font-size", "14px");
  await expect(createBranch).toHaveCSS("opacity", "0");

  await branchRow.hover();
  await expect(createBranch).toHaveCSS("opacity", "1");
  await expect(createBranch).toHaveAccessibleName("New branch");

  await createBranch.focus();
  await expect(createBranch).toHaveCSS("opacity", "1");

  await createBranch.click();
  await expect(page.getByRole("dialog", { name: "Branch this conversation" })).toBeVisible();
});

test("co-located header and composer controls share a hit-target height", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const headerControls = [
    page.getByRole("button", { name: "Thread view" }),
    page.getByRole("button", { name: "Canvas view" }),
    page.getByRole("button", { name: "Dark theme" }),
    page.getByRole("button", { name: "Open settings" }),
  ];
  const composer = page.getByTestId("chat-composer");
  const composerControls = [
    composer.getByTestId("provider-trigger"),
    composer.getByTestId("fast-mode-toggle"),
    composer.getByTestId("thinking-level-trigger"),
    composer.getByRole("button", { name: "New branch" }),
    composer.getByRole("button", { name: "Send message" }),
  ];

  for (const controls of [headerControls, composerControls]) {
    for (const control of controls) {
      await expect(control).toBeVisible();
      await expect(control).toHaveCSS("height", "36px");
    }
  }
});
