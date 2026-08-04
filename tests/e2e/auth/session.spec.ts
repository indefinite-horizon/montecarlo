/** Authentication route guards and local magic-link session lifecycle. */

import { expect, test } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { uniqueEmail } from "../helpers/ids";

test("unauthenticated visitor is redirected to login without rendering workspace data", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByTestId("auth-submit")).toBeVisible();
  await expect(page.getByTestId("workspace-app")).toHaveCount(0);
});

test("magic-link sign-in opens the workspace and survives reload", async ({ page }) => {
  await signIn(page, uniqueEmail("auth-session"));
  await expect(page).toHaveURL(/\/$/u);
  await page.reload();
  await expect(page.getByTestId("workspace-app")).toBeVisible();
});

test("expired session returns the user to login", async ({ page, context }) => {
  await signIn(page, uniqueEmail("auth-expired"));
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByTestId("workspace-app")).toHaveCount(0);
});

test("authenticated user cannot return to login", async ({ page }) => {
  await signIn(page, uniqueEmail("auth-login-redirect"));
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByTestId("workspace-app")).toBeVisible();
});

test("login page exposes email and disabled unconfigured Google sign-in", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("auth-email")).toBeVisible();
  await expect(page.getByTestId("auth-submit")).toBeVisible();
  await expect(page.getByTestId("google-sign-in")).toBeDisabled();
});
