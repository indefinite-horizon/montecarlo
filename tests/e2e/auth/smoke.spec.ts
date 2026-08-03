/** Core Playwright smoke tests for auth and the starter home page. */

import { expect, test } from "@playwright/test";
import { signIn, signOut } from "../helpers/auth";
import { uniqueEmail } from "../helpers/ids";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("google-sign-in")).toBeVisible();
  await expect(page.getByTestId("google-sign-in")).toBeDisabled();
  await expect(page.getByTestId("auth-submit")).toBeVisible();
});

test("default magic-link login reaches home and sign-out returns to auth", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId("home-page")).toBeVisible();
  await signOut(page);
  await expect(page.getByTestId("auth-submit")).toBeVisible();
});

test("fresh email signs in through magic link", async ({ page }) => {
  await signIn(page, uniqueEmail());
  await expect(page.getByTestId("home-page")).toBeVisible();
});
