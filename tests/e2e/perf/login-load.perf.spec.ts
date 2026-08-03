/** Lightweight performance smoke test for the login page. */

import { expect, test } from "@playwright/test";

test("login page loads under the smoke threshold", async ({ page }) => {
  const startedAt = Date.now();
  await page.goto("/login");
  await expect(page.getByTestId("auth-submit")).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(5_000);
});
