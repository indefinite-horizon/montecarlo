/** Canvas rendering, ancestry highlighting, and in-canvas follow-up journeys. */

import { expect, type Page, test } from "@playwright/test";
import { conversationRequests, installRuntimeMock, type RuntimeMock } from "../helpers/runtime";
import { captureScreenshot } from "../helpers/screenshots";
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
  await page.setViewportSize({ width: 1600, height: 1000 });
  runtime = await installRuntimeMock(context);
  await openFreshUser(page, "thread-canvas");
  await createWorkspace(page, `Canvas workspace ${Date.now()}`);
});

function canvasCard(page: Page, title: string) {
  return page.getByTestId("conversation-canvas").getByRole("article", { name: title, exact: true });
}

async function createBranchAndWait(page: Page, prompt: string) {
  await createPromptBranch(page, prompt);
  await expect(assistantMessage(page, `Stub response: ${prompt}`)).toBeVisible();
}

async function openCanvas(page: Page) {
  const toggle = page.getByRole("button", { name: "Canvas view" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("conversation-canvas")).toBeVisible();
}

test("toggles a populated multi-turn DAG and highlights the hovered ancestry", async ({
  page,
}, testInfo) => {
  await sendMessage(
    page,
    "Explain Monte Carlo variance",
    "Stub response: Explain Monte Carlo variance",
  );
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(
    "Explain Monte Carlo variance",
  );
  await createBranchAndWait(page, "Control variates path");
  await sendMessage(
    page,
    "Show a numerical control variate example",
    "Stub response: Show a numerical control variate example",
  );
  await createBranchAndWait(page, "Failure assumptions");

  await page
    .getByRole("complementary")
    .last()
    .getByRole("button", { name: "Explain Monte Carlo variance", exact: true })
    .click();
  await createBranchAndWait(page, "Stratification path");

  await openCanvas(page);
  const canvas = page.getByTestId("conversation-canvas");
  await expect(canvas.getByTestId("canvas-branch-node")).toHaveCount(4);
  await expect(canvas.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Zoom out" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Fit canvas to view" })).toBeVisible();

  const root = canvasCard(page, "Explain Monte Carlo variance");
  const controlVariates = canvasCard(page, "Control variates path");
  const failureAssumptions = canvasCard(page, "Failure assumptions");
  const stratification = canvasCard(page, "Stratification path");
  await expect(controlVariates).toContainText("Control variates path");
  await expect(controlVariates).toContainText("Stub response: Control variates path");
  await expect(controlVariates).toContainText("Show a numerical control variate example");
  await expect(controlVariates).toContainText(
    "Stub response: Show a numerical control variate example",
  );

  await failureAssumptions.hover();
  await expect(root).toHaveAttribute("data-path-active", "true");
  await expect(controlVariates).toHaveAttribute("data-path-active", "true");
  await expect(failureAssumptions).toHaveAttribute("data-path-active", "true");
  await expect(stratification).toHaveAttribute("data-path-active", "false");
  await expect(canvas.locator('[data-testid="canvas-edge"][data-path-active="true"]')).toHaveCount(
    2,
  );
  await expect(canvas.locator('[data-testid="canvas-edge"][data-path-active="false"]')).toHaveCount(
    1,
  );
  await captureScreenshot(page, testInfo, "canvas-hover-path");

  const threadToggle = page.getByRole("button", { name: "Thread view", exact: true });
  await threadToggle.click();
  await expect(threadToggle).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveCount(0);
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(
    "Explain Monte Carlo variance",
  );
  await expect(userMessage(page, "Stratification path")).toBeVisible();
});

test("creates a selected-text follow-up and shows its loading and completed states", async ({
  page,
}, testInfo) => {
  await sendMessage(
    page,
    "Explain control variates and stratification",
    "Stub response: Explain control variates and stratification",
  );
  await openCanvas(page);

  await selectAssistantText(page, "control variates");
  await page.getByRole("button", { name: "Follow this thread" }).click();

  const canvas = page.getByTestId("conversation-canvas");
  const dialog = canvas.getByRole("dialog", { name: "Ask follow-up" });
  await expect(dialog).toContainText("control variates");
  const prompt = "Explain the practical tradeoff clearly [e2e:slow]";
  await dialog.getByLabel("Follow-up question").fill(prompt);
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();

  const branchCard = canvas
    .getByRole("article")
    .filter({ hasText: "Explain the practical tradeoff clearly" });
  await expect(branchCard).toHaveAttribute("aria-busy", "true");
  await expect(branchCard.getByRole("status", { name: "Generating response" })).toBeVisible();
  await captureScreenshot(page, testInfo, "canvas-branch-loading");

  await expect(
    branchCard
      .getByRole("document")
      .filter({ hasText: "Stub response: Explain the practical tradeoff clearly" }),
  ).toBeVisible();
  await expect(branchCard).toHaveAttribute("aria-busy", "false");
  await expect(canvas.getByTestId("canvas-branch-node")).toHaveCount(2);
  await expect(canvas.getByTestId("canvas-edge")).toHaveCount(1);

  expect(conversationRequests(runtime)).toHaveLength(2);
  const request = conversationRequests(runtime).at(-1);
  expect(request?.messages.some(({ content }) => content.includes("control variates"))).toBe(true);
  expect(request?.messages.at(-1)).toEqual({ role: "user", content: prompt });
  await captureScreenshot(page, testInfo, "canvas-branch-complete");
});
