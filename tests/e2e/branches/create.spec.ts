/** Prompt, selection, and nested branch creation semantics. */

import { expect, test } from "@playwright/test";
import { installRuntimeMock, type RuntimeMock } from "../helpers/runtime";
import {
  assistantMessage,
  createPromptBranch,
  createWorkspace,
  openFreshUser,
  selectAssistantText,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

let runtime: RuntimeMock;

test.beforeEach(async ({ context, page }) => {
  runtime = await installRuntimeMock(context);
  await openFreshUser(page, "branch-create");
  await createWorkspace(page, `Branch workspace ${Date.now()}`);
});

test("prompt-only branch requires a non-whitespace prompt", async ({ page }) => {
  await page.getByRole("button", { name: "New branch" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Branch this conversation" });
  const create = dialog.getByRole("button", { name: "Create branch" });
  await expect(create).toBeDisabled();
  await dialog.getByLabel("What should this branch explore?").fill("   ");
  await expect(create).toBeDisabled();
  await dialog.getByLabel("What should this branch explore?").fill("A valid direction");
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByRole("button", { name: "A valid direction", exact: true })).toHaveCount(1);
});

test("prompt-only branch leaves its parent transcript unchanged", async ({ page }) => {
  await sendMessage(page, "Parent-only turn", "Stub response: Parent-only turn");
  await createPromptBranch(page, "Child-only direction");
  await expect(userMessage(page, "Child-only direction")).toBeVisible();

  await page.getByRole("button", { name: "New conversation", exact: true }).last().click();
  await expect(userMessage(page, "Parent-only turn")).toBeVisible();
  await expect(userMessage(page, "Child-only direction")).toHaveCount(0);
});

test("branches from selected assistant text without requiring a prompt", async ({ page }) => {
  await sendMessage(
    page,
    "[reply:A selectable passage about variance] Give a selectable answer",
    "A selectable passage about variance",
  );
  await selectAssistantText(page, "selectable passage");
  await page.getByRole("button", { name: "Follow this thread" }).click();
  const dialog = page.getByRole("dialog", { name: "Branch from selection" });
  await expect(dialog).toContainText("selectable passage");
  await expect(dialog.getByRole("button", { name: "Create branch" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(page.getByText("Following a branch from", { exact: true })).toBeVisible();
  await expect(page.getByText("selectable passage", { exact: false })).toBeVisible();
  expect(runtime.chatRequests).toHaveLength(1);
});

test("selection branch with a prompt sends selection provenance in normalized context", async ({
  page,
}) => {
  await sendMessage(
    page,
    "[reply:Compare control variates with stratification] Give context",
    "Compare control variates with stratification",
  );
  await selectAssistantText(page, "control variates");
  await page.getByRole("button", { name: "Follow this thread" }).click();
  const dialog = page.getByRole("dialog", { name: "Branch from selection" });
  await dialog.getByLabel("Add a direction (optional)").fill("Explain the tradeoff");
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(assistantMessage(page, "Stub response: Explain the tradeoff")).toBeVisible();

  const request = runtime.chatRequests.at(-1);
  expect(request?.messages.some(({ content }) => content.includes("control variates"))).toBe(true);
  expect(request?.messages.at(-1)).toEqual({ role: "user", content: "Explain the tradeoff" });
});

test("stale selected text is cleared when the transcript scrolls", async ({ page }) => {
  await sendMessage(
    page,
    "[reply:Selection that must become stale] Give scroll selection",
    "Selection that must become stale",
  );
  await selectAssistantText(page, "must become stale");
  await page
    .getByRole("document")
    .last()
    .evaluate((element) => {
      const scroller = element.parentElement?.parentElement;
      scroller?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
  await expect(page.getByRole("button", { name: "Follow this thread" })).toHaveCount(0);
});

test("nested branching creates one child per action at the expected depth", async ({ page }) => {
  await createPromptBranch(page, "First-level branch");
  await createPromptBranch(page, "Second-level branch");
  const first = page.getByRole("button", { name: "First-level branch", exact: true });
  const second = page.getByRole("button", { name: "Second-level branch", exact: true });
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);
  const firstMargin = await first.evaluate(
    (element) => (element.parentElement as HTMLElement).style.marginLeft,
  );
  const secondMargin = await second.evaluate(
    (element) => (element.parentElement as HTMLElement).style.marginLeft,
  );
  expect(Number.parseInt(secondMargin, 10)).toBeGreaterThan(Number.parseInt(firstMargin, 10));
});
