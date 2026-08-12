/** Local workspace lifecycle and tenant-visible isolation. */

import { expect, test } from "@playwright/test";
import { installRuntimeMock } from "../helpers/runtime";
import {
  createProject,
  createWorkspace,
  openFreshUser,
  selectWorkspace,
  workspaceButton,
} from "../helpers/workspace";

test.beforeEach(async ({ context, page }) => {
  await installRuntimeMock(context);
  await openFreshUser(page, "workspace-lifecycle");
});

test("creates distinct local workspaces", async ({ page }) => {
  const firstName = `First local ${Date.now()}`;
  const secondName = `Second local ${Date.now()}`;
  await createWorkspace(page, firstName);
  await createProject(page, "Local project");
  await createWorkspace(page, secondName, firstName);
  await expect(page.getByText("Files on this device")).toBeVisible();
  await expect(page.getByText("Local project", { exact: true })).toHaveCount(0);

  await selectWorkspace(page, secondName, firstName);
  await expect(page.getByText("Files on this device")).toBeVisible();
  await expect(page.getByText("Local project", { exact: true })).toBeVisible();
});

test("workspace creation trims names and prevents blank submission", async ({ page }) => {
  await workspaceButton(page, "My Workspace").click();
  const menu = page.getByRole("menu", { name: "Workspaces" });
  await expect(menu).toBeVisible();
  await expect(page.getByRole("dialog", { name: "New workspace" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "New workspace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New workspace" });
  await expect(dialog.getByRole("button", { name: "Cloud object storage" })).toHaveCount(0);
  const submit = dialog.getByRole("button", { name: "Create workspace" });
  await dialog.getByLabel("Workspace name").fill("   ");
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Workspace name").fill("  Trimmed workspace  ");
  await submit.click();
  await expect(workspaceButton(page, "Trimmed workspace")).toBeVisible();
});

test("workspace projects, chats, and branches stay isolated while switching", async ({ page }) => {
  await createWorkspace(page, "Workspace Alpha");
  await createProject(page, "Alpha-only project");
  await page.getByRole("button", { name: "New branch" }).first().click();
  const branchDialog = page.getByRole("dialog", { name: "Branch this conversation" });
  await branchDialog.getByLabel("What should this branch explore?").fill("Alpha branch");
  await branchDialog.getByRole("button", { name: "Create branch" }).click();
  const alphaBranch = page
    .locator('[data-testid="branch-map-row"][data-branch-depth="1"]')
    .filter({ hasText: "Alpha branch" });

  await createWorkspace(page, "Workspace Beta", "Workspace Alpha");
  await expect(page.getByText("Alpha-only project", { exact: true })).toHaveCount(0);
  await expect(alphaBranch).toHaveCount(0);

  await selectWorkspace(page, "Workspace Beta", "Workspace Alpha");
  await expect(page.getByText("Alpha-only project", { exact: true })).toBeVisible();
  await expect(alphaBranch).toBeVisible();
});
