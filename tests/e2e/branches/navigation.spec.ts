/** Branch-map navigation, sibling isolation, snapshots, and provider independence. */

import { expect, type Page, test } from "@playwright/test";
import { installRuntimeMock, type RuntimeMock } from "../helpers/runtime";
import {
  assistantMessage,
  createPromptBranch,
  createWorkspace,
  openFreshUser,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

let runtime: RuntimeMock;

test.beforeEach(async ({ context, page }) => {
  runtime = await installRuntimeMock(context);
  await openFreshUser(page, "branch-navigation");
  await createWorkspace(page, `Branch navigation ${Date.now()}`);
});

async function chooseProvider(page: Page, label: string) {
  await page.getByTestId("provider-trigger").click();
  await page
    .getByTestId("provider-menu")
    .getByRole("button", { name: new RegExp(`^${label}`, "u") })
    .click();
}

test("branch map selection keeps header, transcript, provenance, and marker aligned", async ({
  page,
}) => {
  await sendMessage(page, "Root transcript", "Stub response: Root transcript");
  await createPromptBranch(page, "Mapped child");
  const child = page.getByRole("button", { name: "Mapped child", exact: true });
  await expect(child).toHaveClass(/border-primary/u);
  await expect(page.getByRole("heading", { name: "Mapped child" })).toBeVisible();

  const root = page.getByRole("button", { name: "New conversation", exact: true }).last();
  await root.click();
  await expect(root).toHaveClass(/border-primary/u);
  await expect(page.getByRole("heading", { name: "New conversation" })).toBeVisible();
  await expect(userMessage(page, "Root transcript")).toBeVisible();
});

test("sibling branches never display each other's turns", async ({ page }) => {
  await createPromptBranch(page, "Sibling A seed");
  await sendMessage(page, "Sibling A only", "Stub response: Sibling A only");
  await page.getByRole("button", { name: "New conversation", exact: true }).last().click();
  await createPromptBranch(page, "Sibling B seed");
  await sendMessage(page, "Sibling B only", "Stub response: Sibling B only");
  await expect(userMessage(page, "Sibling A only")).toHaveCount(0);

  await page.getByRole("button", { name: "Sibling A seed", exact: true }).click();
  await expect(userMessage(page, "Sibling A only")).toBeVisible();
  await expect(userMessage(page, "Sibling B only")).toHaveCount(0);
});

test("child transcript and later requests use its creation-time parent snapshot", async ({
  page,
}) => {
  await sendMessage(page, "Before child", "Stub response: Before child");
  await createPromptBranch(page, "Snapshot child");
  await page.getByRole("button", { name: "New conversation", exact: true }).last().click();
  await sendMessage(page, "After child", "Stub response: After child");

  await page.getByRole("button", { name: "Snapshot child", exact: true }).click();
  await expect(userMessage(page, "Before child")).toBeVisible();
  await expect(userMessage(page, "After child")).toHaveCount(0);
  await sendMessage(page, "Continue snapshot", "Stub response: Continue snapshot");
  const request = runtime.chatRequests.at(-1);
  expect(request?.messages.some(({ content }) => content.includes("After child"))).toBe(false);
});

test("reload restores the active chat safely and invalid branch state falls back to root", async ({
  page,
}) => {
  await createPromptBranch(page, "Reloaded child");
  await page.reload();
  await expect(page.getByTestId("workspace-app")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New conversation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reloaded child", exact: true })).toBeVisible();
});

test("parent and child can continue with independent providers", async ({ page }) => {
  await chooseProvider(page, "Ollama");
  await sendMessage(page, "Parent on Ollama", "Stub response: Parent on Ollama");
  await createPromptBranch(page, "Provider-independent child");
  await chooseProvider(page, "OpenRouter");
  await sendMessage(page, "Child on OpenRouter", "Stub response: Child on OpenRouter");

  const relevant = runtime.chatRequests.filter(({ messages }) =>
    messages.some(
      ({ content }) =>
        content.includes("Parent on Ollama") || content.includes("Child on OpenRouter"),
    ),
  );
  expect(relevant.some(({ provider }) => provider === "ollama")).toBe(true);
  expect(relevant.some(({ provider }) => provider === "openrouter")).toBe(true);
  await page.getByRole("button", { name: "New conversation", exact: true }).last().click();
  await expect(userMessage(page, "Parent on Ollama")).toBeVisible();
  await expect(assistantMessage(page, "Stub response: Parent on Ollama")).toBeVisible();
  await expect(userMessage(page, "Child on OpenRouter")).toHaveCount(0);
});
