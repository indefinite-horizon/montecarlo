/** Keyboard reachability for primary composition and branching commands. */

import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { installRuntimeMock } from "../helpers/runtime";
import { createWorkspace, openFreshUser, userMessage } from "../helpers/workspace";

const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
const newChatShortcutLabel = process.platform === "darwin" ? "⌘N" : "Ctrl+Shift+N";
const newChatShortcutKeys = process.platform === "darwin" ? "Meta+N" : "Control+Shift+N";
const thinkingShortcutLabel = process.platform === "darwin" ? "⌥T" : "Alt+T";

test.beforeEach(async ({ context, page }) => {
  await installRuntimeMock(context);
  await openFreshUser(page, "keyboard");
  await createWorkspace(page, `Keyboard workspace ${Date.now()}`);
});

test("a bootstrapped workspace enables the composer and accepts typing", async ({ page }) => {
  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  await expect(page.getByTestId("chat-breadcrumb-title")).toBeVisible({
    timeout: 15_000,
  });
  await expect(composer).toBeEnabled();
  await composer.click();
  await composer.fill("The repaired workspace accepts input");
  await expect(composer).toHaveValue("The repaired workspace accepts input");
});

test("a legacy workspace with no chats repairs its root conversation", async ({ page }) => {
  const convexUrl = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL;
  if (!convexUrl || !convexSiteUrl) {
    throw new Error("Convex cloud and site URLs are required for browser E2E.");
  }
  const tokenResponse = await page.context().request.get(`${convexSiteUrl}/api/auth/convex/token`);
  if (!tokenResponse.ok()) throw new Error("Could not obtain the current Convex session token.");
  const tokenPayload = (await tokenResponse.json()) as { token?: string };
  if (!tokenPayload.token) throw new Error("The Convex session token was missing.");
  const token = tokenPayload.token;

  const name = `Legacy empty workspace ${Date.now()}`;
  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(token);
  await convex.mutation(api.workspaces.create, { name, storageMode: "local" });

  await page.getByTestId("workspace-selector").click();
  await page.getByRole("menu", { name: "Workspaces" }).getByText(name, { exact: true }).click();

  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  await expect(page.getByTestId("chat-breadcrumb-title")).toBeVisible({
    timeout: 15_000,
  });
  await expect(composer).toBeEnabled();
  await composer.fill("Legacy workspace repaired");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
});

test("message and prompt-branch flows are operable from the keyboard", async ({ page }) => {
  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  await composer.focus();
  await composer.fill("Keyboard message");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled({
    timeout: 15_000,
  });
  await composer.press("Enter");
  await expect(userMessage(page, "Keyboard message")).toBeVisible();

  const newBranch = page.getByRole("button", { name: "New branch" }).first();
  await expect(newBranch).toBeEnabled({ timeout: 15_000 });
  await newBranch.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Branch this conversation" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("What should this branch explore?").fill("Keyboard branch");
  await dialog.getByRole("button", { name: "Create branch" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Keyboard branch", exact: true })).toBeVisible();
});

test("global shortcuts open commands and cycle thinking without changing views", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  const thinkingTrigger = page.getByTestId("thinking-level-trigger");
  await expect(thinkingTrigger).toHaveAccessibleName(/Medium/u);
  await composer.focus();

  await page.keyboard.press(`${primaryModifier}+K`);
  const commandPalette = page.getByTestId("command-palette-dialog");
  await expect(commandPalette).toBeVisible();
  await expect(page.getByTestId("command-palette-input")).toBeFocused();
  await expect(page.getByTestId("command-new-chat")).toContainText(newChatShortcutLabel);
  await page.getByTestId("command-adjust-thinking").click();
  await expect(commandPalette).toHaveCount(0);
  await expect(thinkingTrigger).toHaveAccessibleName(/High/u);

  await composer.focus();
  await page.keyboard.press("Alt+P");
  await expect(page.getByTestId("provider-menu")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("provider-option-codex")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("provider-models-codex")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("provider-menu")).toHaveCount(0);
  await expect(page.getByTestId("provider-trigger")).not.toBeFocused();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "Select provider and model" }),
  ).toHaveCount(0);

  await composer.focus();
  await page.keyboard.press("Alt+T");
  await expect(thinkingTrigger).toHaveAccessibleName(/Extra high/u);
  await expect(composer).toBeFocused();
  await expect(page.getByTestId("thinking-level-menu")).toHaveCount(0);
  await expect(page.getByRole("tooltip").filter({ hasText: "Adjust thinking level" })).toHaveCount(
    0,
  );
  expect(pageErrors, "global shortcuts must not cause uncaught page errors").toEqual([]);

  await page.getByRole("button", { name: "Canvas view" }).click();
  await page.keyboard.press("Alt+T");
  await expect(page.getByRole("button", { name: "Canvas view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Alt+P");
  await expect(page.getByTestId("provider-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(thinkingTrigger).toHaveAccessibleName(/Max/u);
  await expect(page.getByRole("button", { name: "Thread view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await thinkingTrigger.hover();
  const tooltip = page.getByRole("tooltip").filter({ hasText: "Adjust thinking level" });
  await expect(tooltip).toBeVisible();
  await expect(tooltip.getByText(thinkingShortcutLabel, { exact: true })).toBeVisible();

  const chatRows = page
    .getByRole("navigation", { name: "Projects and chats" })
    .getByTestId("chat-row");
  const before = await chatRows.count();
  await page.keyboard.press(newChatShortcutKeys);
  await expect(chatRows).toHaveCount(before + 1);
  expect(pageErrors, "global shortcuts must not cause uncaught page errors").toEqual([]);
});
