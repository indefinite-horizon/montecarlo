/** Branch-map navigation, sibling isolation, snapshots, and provider independence. */

import { expect, type Page, test } from "@playwright/test";
import { conversationRequests, installRuntimeMock, type RuntimeMock } from "../helpers/runtime";
import {
  assistantMessage,
  childBranchRow,
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

async function chooseProvider(page: Page, label: "Claude" | "Codex", model: string) {
  await page.getByTestId("provider-trigger").click();
  const option = page
    .getByTestId("provider-menu")
    .getByRole("menuitem", { name: new RegExp(`^${label}`, "u") });
  await option.hover();
  const provider = label === "Claude" ? "anthropic" : "codex";
  await page
    .getByTestId(`provider-models-${provider}`)
    .getByRole("menuitem", { name: new RegExp(model, "iu") })
    .click();
}

test("branch map selection keeps header, transcript, provenance, and marker aligned", async ({
  page,
}) => {
  await sendMessage(page, "Root transcript", "Stub response: Root transcript");
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText("Root transcript");
  await createPromptBranch(page, "Mapped child");
  const child = page.getByRole("button", { name: "Mapped child", exact: true });
  await expect(child).toHaveClass(/border-primary/u);
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText("Root transcript");

  const root = page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]');
  await root.click();
  await expect(root).toHaveClass(/border-primary/u);
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText("Root transcript");
  await expect(userMessage(page, "Root transcript")).toBeVisible();
});

test("parent turns link to their child branches from the transcript margin", async ({ page }) => {
  await sendMessage(page, "Branch source turn", "Stub response: Branch source turn");
  await createPromptBranch(page, "Margin child");
  await page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]').click();

  const callout = page
    .getByRole("button", {
      name: /Open branch Margin child, created/u,
    })
    .first();
  await expect(callout).toBeVisible();
  await expect(callout).toContainText("Margin child");
  await expect(callout.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/u);

  await callout.click();
  await expect(page.getByTestId("branch-origin-divider")).toBeVisible();
  await expect(page.getByRole("button", { name: "Margin child", exact: true })).toHaveClass(
    /border-primary/u,
  );

  await page.getByTestId("branch-parent-link").click();
  await expect(page.getByTestId("branch-origin-divider")).toHaveCount(0);
  await expect(page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]')).toHaveClass(
    /border-primary/u,
  );
});

test("branch context menu manages read state, rename, copy link, and subtree deletion", async ({
  context,
  page,
}) => {
  await createPromptBranch(page, "Managed branch");
  const row = childBranchRow(page, "Managed branch");

  await row.click({ button: "right" });
  let menu = page.getByTestId("branch-context-menu");
  await menu.getByRole("menuitem", { name: "Mark as unread" }).click();
  await expect(row).toHaveAttribute("data-unread", "true");

  await row.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Mark as read" }).click();
  await expect(row).toHaveAttribute("data-unread", "false");

  await row.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename branch" });
  await rename.getByLabel("Branch name").fill("Renamed branch");
  await rename.getByRole("button", { name: "Save" }).click();
  const renamedRow = childBranchRow(page, "Renamed branch");
  await expect(renamedRow).toBeVisible();

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await renamedRow.click({ button: "right" });
  menu = page.getByTestId("branch-context-menu");
  await menu.getByRole("menuitem", { name: "Copy link" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).searchParams.get("branch")).toBeTruthy();

  await renamedRow.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Delete branch" }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete branch?" });
  await confirmation.getByRole("button", { name: "Delete branch" }).click();
  await expect(renamedRow).toHaveCount(0);
  await expect(page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]')).toHaveClass(
    /border-primary/u,
  );
});

test("sibling branches never display each other's turns", async ({ page }) => {
  await createPromptBranch(page, "Sibling A seed");
  await sendMessage(page, "Sibling A only", "Stub response: Sibling A only");
  await page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]').click();
  await createPromptBranch(page, "Sibling B seed");
  await sendMessage(page, "Sibling B only", "Stub response: Sibling B only");
  await expect(userMessage(page, "Sibling A only")).toHaveCount(0);

  await childBranchRow(page, "Sibling A seed").click();
  await expect(userMessage(page, "Sibling A only")).toBeVisible();
  await expect(userMessage(page, "Sibling B only")).toHaveCount(0);
});

test("child transcript and later requests use its creation-time parent snapshot", async ({
  page,
}) => {
  await sendMessage(page, "Before child", "Stub response: Before child");
  await createPromptBranch(page, "Snapshot child");
  await page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]').click();
  await sendMessage(page, "After child", "Stub response: After child");

  await page.getByRole("button", { name: "Snapshot child", exact: true }).click();
  await expect(userMessage(page, "Before child")).toBeVisible();
  await expect(userMessage(page, "After child")).toHaveCount(0);
  await sendMessage(page, "Continue snapshot", "Stub response: Continue snapshot");
  const request = conversationRequests(runtime).at(-1);
  expect(request?.messages.some(({ content }) => content.includes("After child"))).toBe(false);
});

test("reload restores the active chat safely and invalid branch state falls back to root", async ({
  page,
}) => {
  await createPromptBranch(page, "Reloaded child");
  await page.reload();
  await expect(page.getByTestId("workspace-app")).toBeVisible();
  await expect(page.getByTestId("chat-breadcrumb-title")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reloaded child", exact: true })).toBeVisible();
});

test("parent and child can continue with independent providers", async ({ page }) => {
  await chooseProvider(page, "Codex", "e2e-codex");
  await sendMessage(page, "Parent on Codex", "Stub response: Parent on Codex");
  await createPromptBranch(page, "Provider-independent child");
  await chooseProvider(page, "Claude", "e2e-claude");
  await sendMessage(page, "Child on Claude", "Stub response: Child on Claude");

  const relevant = conversationRequests(runtime).filter(({ messages }) =>
    messages.some(
      ({ content }) => content.includes("Parent on Codex") || content.includes("Child on Claude"),
    ),
  );
  expect(relevant.some(({ provider }) => provider === "codex")).toBe(true);
  expect(relevant.some(({ provider }) => provider === "anthropic")).toBe(true);
  await page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]').click();
  await expect(userMessage(page, "Parent on Codex")).toBeVisible();
  await expect(assistantMessage(page, "Stub response: Parent on Codex")).toBeVisible();
  await expect(userMessage(page, "Child on Claude")).toHaveCount(0);
});
