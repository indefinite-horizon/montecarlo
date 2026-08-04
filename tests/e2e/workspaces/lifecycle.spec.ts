/** Local/cloud workspace lifecycle and tenant-visible isolation. */

import { expect, test } from "@playwright/test";
import { installRuntimeMock } from "../helpers/runtime";
import {
  createProject,
  createWorkspace,
  openFreshUser,
  workspaceButton,
} from "../helpers/workspace";

test.beforeEach(async ({ context, page }) => {
  await installRuntimeMock(context);
  await openFreshUser(page, "workspace-lifecycle");
});

test("creates distinct local-storage and cloud-storage workspaces", async ({ page }) => {
  const localName = `Local ${Date.now()}`;
  const cloudName = `Cloud ${Date.now()}`;
  await createWorkspace(page, localName);
  await createProject(page, "Local project");
  await createWorkspace(page, cloudName, "cloud", localName);
  await expect(page.getByText("Cloud file storage")).toBeVisible();
  await expect(page.getByText("Local project", { exact: true })).toHaveCount(0);

  await workspaceButton(page, cloudName).click();
  await workspaceButton(page, localName).click();
  await expect(page.getByText("Files on this device")).toBeVisible();
  await expect(page.getByText("Local project", { exact: true })).toBeVisible();
});

test("workspace creation trims names and prevents blank submission", async ({ page }) => {
  await workspaceButton(page, "Richard's workspace").click();
  const dialog = page.getByRole("dialog", { name: "Where should message content be stored?" });
  const submit = dialog.getByRole("button", { name: "Create with device storage" });
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

  await createWorkspace(page, "Workspace Beta", "local", "Workspace Alpha");
  await expect(page.getByText("Alpha-only project", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Alpha branch", exact: true })).toHaveCount(0);

  await workspaceButton(page, "Workspace Beta").click();
  await workspaceButton(page, "Workspace Alpha").click();
  await expect(page.getByText("Alpha-only project", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Alpha branch", exact: true })).toBeVisible();
});
