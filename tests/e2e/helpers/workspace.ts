/** High-level helpers for isolated durable workspace journeys. */

import { expect, type Page } from "@playwright/test";
import { foodChatNames } from "../../../lib/foodChatNames";
import { signIn } from "./auth";
import { uniqueEmail } from "./ids";

export async function openFreshUser(page: Page, prefix = "workspace") {
  await signIn(page, uniqueEmail(prefix));
}

export async function createWorkspace(
  page: Page,
  name: string,
  mode: "local" | "cloud" = "local",
  currentWorkspaceName = "My Workspace",
) {
  await workspaceButton(page, currentWorkspaceName).click();
  const menu = page.getByRole("menu", { name: "Workspaces" });
  await expect(menu).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Where should message content be stored?" }),
  ).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "New workspace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Where should message content be stored?" });
  await expect(dialog).toBeVisible();
  if (mode === "cloud") {
    await dialog.getByRole("button", { name: "Cloud object storage", exact: true }).click();
  }
  await dialog.getByLabel("Workspace name").fill(name);
  const createButton = dialog.getByRole("button", {
    name: mode === "local" ? "Create with device storage" : "Create with cloud storage",
  });
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(dialog).toBeHidden();
  await expect(workspaceButton(page, name)).toBeVisible();
  const title = page.getByTestId("chat-breadcrumb-title");
  await expect(title).not.toHaveText("", { timeout: 15_000 });
  expect(foodChatNames).toContain((await title.innerText()).trim());
  return (await title.innerText()).trim();
}

export function workspaceButton(page: Page, name: string) {
  return page.getByTestId("workspace-selector").filter({ hasText: name });
}

export async function selectWorkspace(page: Page, currentName: string, nextName: string) {
  await workspaceButton(page, currentName).click();
  const menu = page.getByRole("menu", { name: "Workspaces" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem").filter({ hasText: nextName }).click();
  await expect(workspaceButton(page, nextName)).toBeVisible();
}

export async function createProject(page: Page, name: string) {
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
}

export async function createChat(page: Page, projectName?: string) {
  const navigation = page.getByRole("navigation", { name: "Projects and chats" });
  const section = navigation
    .locator("section")
    .filter({ hasText: projectName ?? "Without a project" });
  const rows = section.getByTestId("chat-row");
  const before = await rows.count();
  if (projectName) {
    await page.getByRole("button", { name: `New chat — ${projectName}` }).click();
  } else {
    await page.getByRole("button", { name: "New chat", exact: true }).click();
  }
  await expect(rows).toHaveCount(before + 1);
  const activeRow = section.locator('button[aria-current="page"]');
  await expect(activeRow).toBeVisible();
  const title = (await activeRow.innerText()).trim();
  expect(foodChatNames).toContain(title);
  return title;
}

export function activeChatRow(page: Page) {
  return page
    .getByRole("navigation", { name: "Projects and chats" })
    .locator('button[aria-current="page"]');
}

export async function sendMessage(page: Page, prompt: string, reply?: string) {
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await expect(userMessage(page, prompt)).toBeVisible();
  if (reply !== undefined) {
    await expect(assistantMessage(page, reply)).toBeVisible({ timeout: 15_000 });
  }
  await expect(send).toBeVisible({ timeout: 15_000 });
}

export function userMessage(page: Page, text: string) {
  return page
    .getByRole("article")
    .filter({ has: page.getByText("You", { exact: true }) })
    .filter({ hasText: text });
}

export function assistantMessage(page: Page, text: string) {
  return page.locator('[role="document"]').filter({ hasText: text });
}

export async function createPromptBranch(page: Page, prompt: string) {
  await page.getByRole("button", { name: "New branch" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Branch this conversation" });
  await dialog.getByLabel("What should this branch explore?").fill(prompt);
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: prompt, exact: true })).toBeVisible();
}

export async function selectAssistantText(page: Page, text: string) {
  const document = page.locator('[role="document"]').filter({ hasText: text }).last();
  await document.evaluate((element, selectedText) => {
    const walker = window.document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = node.textContent ?? "";
      const start = value.indexOf(selectedText);
      if (start >= 0) {
        const range = window.document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + selectedText.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
      node = walker.nextNode();
    }
    throw new Error(`Could not select text: ${selectedText}`);
  }, text);
  await expect(page.getByRole("button", { name: "Follow this thread" })).toBeVisible();
}
