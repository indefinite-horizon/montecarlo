/** Playwright helpers for magic-link authentication. */

import type { Page } from "@playwright/test";
import { sharedConfig } from "../../../lib/config";

export const defaultAuthEmail = sharedConfig.dev.defaultAuthUser.email;

export async function signIn(page: Page, email = defaultAuthEmail) {
  await page.goto("/login");
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-submit").click();
  await page.getByTestId("workspace-app").waitFor();
}

export async function signOut(page: Page) {
  await page.getByTestId("sign-out").click();
  await page.getByTestId("auth-submit").waitFor();
}
