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
  currentWorkspaceName = "My Workspace",
) {
  await workspaceButton(page, currentWorkspaceName).click();
  const menu = page.getByRole("menu", { name: "Workspaces" });
  await expect(menu).toBeVisible();
  await expect(page.getByRole("dialog", { name: "New workspace" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "New workspace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New workspace" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Workspace name").fill(name);
  const createButton = dialog.getByRole("button", { name: "Create workspace" });
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
  const section = projectName
    ? navigation.getByTestId("project-section").filter({ hasText: projectName })
    : navigation.getByTestId("projectless-chats");
  const activeRow = section.locator(
    '[data-testid="chat-row"]:is([aria-current="page"], :has(button[aria-current="page"]))',
  );
  const previousActiveChatId = (await activeRow.count())
    ? await activeRow.getAttribute("data-chat-id")
    : null;
  if (projectName) {
    await page.getByRole("button", { name: `New chat — ${projectName}` }).click();
  } else {
    await page.getByRole("button", { name: "New chat", exact: true }).click();
  }
  await expect(activeRow).toBeVisible();
  await expect.poll(() => activeRow.getAttribute("data-chat-id")).not.toBe(previousActiveChatId);
  const title = (await activeRow.innerText()).trim();
  expect(foodChatNames).toContain(title);
  return title;
}

export function activeChatRow(page: Page) {
  return page
    .getByRole("navigation", { name: "Projects and chats" })
    .locator(
      '[data-testid="chat-row"]:is([aria-current="page"], :has(button[aria-current="page"]))',
    );
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
  return page.getByRole("article", { name: "You", exact: true }).filter({ hasText: text });
}

export function assistantMessage(page: Page, text: string) {
  return page.locator('[role="document"]').filter({ hasText: text });
}

export function childBranchRow(page: Page, title: string) {
  return page
    .locator('[data-testid="branch-map-row"]:not([data-branch-depth="0"])')
    .filter({ hasText: title });
}

export async function createPromptBranch(page: Page, prompt: string) {
  await page.getByRole("button", { name: "New branch" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Branch this conversation" });
  await dialog.getByLabel("What should this branch explore?").fill(prompt);
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(dialog).toBeHidden();
  const branch = childBranchRow(page, prompt);
  await expect(branch).toBeVisible();
  await expect(branch).toHaveAttribute("aria-current", "true");
}

export async function selectAssistantText(page: Page, text: string) {
  const document = page.locator('[role="document"]').filter({ hasText: text }).last();
  await document.evaluate((element, selectedText) => {
    const walker = window.document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
    const combined = nodes.map((node) => node.data).join("");
    const selectionStart = combined.indexOf(selectedText);
    if (selectionStart >= 0) {
      const selectionEnd = selectionStart + selectedText.length;
      let consumed = 0;
      let startBoundary: { node: Text; offset: number } | undefined;
      let endBoundary: { node: Text; offset: number } | undefined;
      for (const node of nodes) {
        const nextConsumed = consumed + node.length;
        if (!startBoundary && selectionStart <= nextConsumed) {
          startBoundary = { node, offset: selectionStart - consumed };
        }
        if (selectionEnd <= nextConsumed) {
          endBoundary = { node, offset: selectionEnd - consumed };
          break;
        }
        consumed = nextConsumed;
      }
      if (startBoundary && endBoundary) {
        const range = window.document.createRange();
        range.setStart(startBoundary.node, startBoundary.offset);
        range.setEnd(endBoundary.node, endBoundary.offset);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
    }
    throw new Error(`Could not select text: ${selectedText}`);
  }, text);
  const action = page.getByTestId("selection-follow-up-action");
  await expect(action).toBeVisible();
  await expect(action).toHaveAccessibleName("Ask Follow-up");
}
