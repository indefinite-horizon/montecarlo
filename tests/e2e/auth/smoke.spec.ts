/** Core Playwright smoke tests for auth and the branch-first workspace. */

import { expect, test } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { uniqueEmail } from "../helpers/ids";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("google-sign-in")).toBeVisible();
  await expect(page.getByTestId("google-sign-in")).toBeDisabled();
  await expect(page.getByTestId("auth-submit")).toBeVisible();
});

test("default magic-link login reaches the workspace", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId("workspace-app")).toBeVisible();
});

test("fresh email signs in through magic link", async ({ page }) => {
  await signIn(page, uniqueEmail());
  await expect(page.getByTestId("workspace-app")).toBeVisible();
});

test("prompt-only branching preserves the parent and opens a child", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-app")).toBeVisible();
  await page.getByRole("button", { name: "New branch" }).first().click();
  const prompt = "Compare this with quasi-Monte Carlo";
  await page.getByLabel("What should this branch explore?").fill(prompt);
  await page.getByRole("button", { name: "Create branch" }).click();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
});
