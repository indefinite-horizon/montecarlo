/** Durable message, streaming, cancellation, failure, and blob journeys. */

import { expect, test } from "@playwright/test";
import {
  conversationRequests,
  installRuntimeMock,
  type RuntimeMock,
  titleRequests,
} from "../helpers/runtime";
import {
  assistantMessage,
  createWorkspace,
  openFreshUser,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

let runtime: RuntimeMock;

test.beforeEach(async ({ context, page }) => {
  runtime = await installRuntimeMock(context);
  await openFreshUser(page, "conversation");
  await createWorkspace(page, `Conversation workspace ${Date.now()}`);
});

test("sends a message, consumes normalized stream events, and persists both turns", async ({
  context,
  page,
}) => {
  await sendMessage(
    page,
    "Explain deterministic sampling",
    "Stub response: Explain deterministic sampling",
  );
  const userTurn = userMessage(page, "Explain deterministic sampling");
  const assistantTurn = page
    .getByRole("article", { name: "Monte Carlo", exact: true })
    .filter({ has: assistantMessage(page, "Stub response: Explain deterministic sampling") });
  await expect(userTurn.getByText("You", { exact: true })).toHaveCount(0);
  await expect(assistantTurn.getByText("Monte Carlo", { exact: true })).toHaveCount(0);

  const userActions = userTurn.getByTestId("message-output-actions");
  await expect(userActions).toHaveCSS("opacity", "0");
  await userTurn.hover();
  await expect(userActions).toHaveCSS("opacity", "1");
  await expect(userTurn.locator("time")).toContainText(/now|ago/u);
  await expect(userTurn.getByRole("button", { name: "Edit message" })).toBeVisible();
  await expect(userTurn.getByRole("button", { name: "Retry" })).toBeVisible();

  await expect.poll(() => titleRequests(runtime).length).toBe(1);
  expect(conversationRequests(runtime)).toHaveLength(1);
  const requestedModel = conversationRequests(runtime)[0]?.model;
  if (!requestedModel) throw new Error("The runtime request did not include a model.");
  const outputActions = assistantTurn.getByTestId("message-output-actions");
  await expect(outputActions).toHaveCSS("opacity", "0");
  const copyOutput = assistantTurn.getByRole("button", { name: "Copy output" });
  await assistantTurn.hover();
  await expect(outputActions).toHaveCSS("opacity", "1");
  const modelMetadata = outputActions.getByTestId("message-model");
  await expect(modelMetadata).toContainText(requestedModel);
  await expect(modelMetadata.locator("svg")).toHaveCount(1);
  await expect(assistantTurn.locator("time")).toContainText(/now|ago/u);
  await assistantTurn.locator("time").hover();
  await expect(page.getByRole("tooltip")).toContainText(
    /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M$/u,
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await copyOutput.click();
  await expect(page.getByText("Output copied.", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Stub response: Explain deterministic sampling");
  expect(conversationRequests(runtime)[0]?.messages.at(-1)).toEqual({
    role: "user",
    content: "Explain deterministic sampling",
  });
  expect(titleRequests(runtime)[0]).toMatchObject({
    provider: conversationRequests(runtime)[0]?.provider,
    model: conversationRequests(runtime)[0]?.model,
    options: { reasoningEffort: "none", fastMode: false },
  });
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(
    "Explain deterministic sampling",
  );

  await page.reload();
  await expect(userMessage(page, "Explain deterministic sampling")).toBeVisible();
  await expect(
    assistantMessage(page, "Stub response: Explain deterministic sampling"),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  const reloadedAssistantTurn = page
    .getByRole("article", { name: "Monte Carlo", exact: true })
    .filter({ has: assistantMessage(page, "Stub response: Explain deterministic sampling") });
  const reloadedOutputActions = reloadedAssistantTurn.getByTestId("message-output-actions");
  await expect(reloadedOutputActions).toHaveCSS("opacity", "0");
  await reloadedAssistantTurn.hover();
  await expect(reloadedOutputActions).toHaveCSS("opacity", "1");
  await expect(reloadedOutputActions.getByTestId("message-model")).toContainText(requestedModel);
  await expect(reloadedOutputActions.getByTestId("message-model").locator("svg")).toHaveCount(1);
});

test("copies model output when the Clipboard API rejects the write", async ({ context, page }) => {
  const output = "Stub response: Copy this model output";
  await sendMessage(page, "Copy this model output", output);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: navigator.clipboard.readText.bind(navigator.clipboard),
        writeText: () => Promise.reject(new DOMException("Clipboard blocked", "NotAllowedError")),
      },
    });
  });

  const assistantTurn = page
    .getByRole("article", { name: "Monte Carlo", exact: true })
    .filter({ has: assistantMessage(page, output) });
  await assistantTurn.hover();
  await assistantTurn.getByRole("button", { name: "Copy output" }).click();

  await expect(page.getByText("Output copied.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(output);
});

test("retry and edit replace a completed turn and truncate subsequent history", async ({
  page,
}) => {
  await sendMessage(page, "First prompt", "Stub response: First prompt");
  await sendMessage(page, "Later prompt", "Stub response: Later prompt");

  const firstTurn = userMessage(page, "First prompt");
  await firstTurn.hover();
  await firstTurn.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => conversationRequests(runtime).length).toBe(3);
  await expect(assistantMessage(page, "Stub response: First prompt")).toBeVisible();
  await expect(userMessage(page, "Later prompt")).toHaveCount(0);
  await expect(assistantMessage(page, "Stub response: Later prompt")).toHaveCount(0);
  await expect(userMessage(page, "First prompt")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
    timeout: 15_000,
  });
  expect(conversationRequests(runtime)[2]?.messages).toEqual([
    { role: "user", content: "First prompt" },
  ]);

  const retriedTurn = userMessage(page, "First prompt");
  await retriedTurn.hover();
  await retriedTurn.getByRole("button", { name: "Edit message" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit message" });
  await dialog.getByRole("textbox", { name: "Message" }).fill("Edited prompt");
  await dialog.getByRole("button", { name: "Save and retry" }).click();
  await expect.poll(() => conversationRequests(runtime).length).toBe(4);
  await expect(userMessage(page, "First prompt")).toHaveCount(0);
  await expect(userMessage(page, "Edited prompt")).toHaveCount(1);
  await expect(assistantMessage(page, "Stub response: Edited prompt")).toBeVisible();

  const editedResponse = page
    .getByRole("article", { name: "Monte Carlo", exact: true })
    .filter({ has: assistantMessage(page, "Stub response: Edited prompt") });
  await editedResponse.hover();
  await editedResponse.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => conversationRequests(runtime).length).toBe(5);
  await expect(userMessage(page, "Edited prompt")).toHaveCount(1);
  await expect(assistantMessage(page, "Stub response: Edited prompt")).toHaveCount(1);

  await page.reload();
  await expect(userMessage(page, "Edited prompt")).toHaveCount(1);
  await expect(userMessage(page, "Later prompt")).toHaveCount(0);
});

test("history edit persists the rewritten turn", async ({ page }) => {
  await sendMessage(page, "Original prompt", "Stub response: Original prompt");
  const turn = userMessage(page, "Original prompt");
  await turn.hover();
  await turn.getByRole("button", { name: "Edit message" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit message" });
  await dialog.getByRole("textbox", { name: "Message" }).fill("Edited prompt");
  await dialog.getByRole("button", { name: "Save and retry" }).click();
  await expect(assistantMessage(page, "Stub response: Edited prompt")).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await page.reload();
  await expect(userMessage(page, "Original prompt")).toHaveCount(0);
  await expect(userMessage(page, "Edited prompt")).toHaveCount(1);
});

test("stops an in-progress generation and ignores its late response", async ({ page }) => {
  const prompt = "[e2e:slow] Cancel this generation";
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect.poll(() => conversationRequests(runtime).length).toBe(1);
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  const canceledUserTurn = userMessage(page, prompt);
  await expect(canceledUserTurn).toBeVisible();
  await canceledUserTurn.hover();
  await expect(canceledUserTurn.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.waitForTimeout(2_200);
  await expect(assistantMessage(page, "Stub response: Cancel this generation")).toHaveCount(0);
  expect(conversationRequests(runtime)).toHaveLength(1);
  expect(titleRequests(runtime)).toHaveLength(1);
  await expect(page.getByTestId("chat-breadcrumb-title")).toHaveText(
    "[e2e:slow] Cancel this generation",
  );
});

test("provider error preserves the user turn and allows a later successful send", async ({
  page,
}) => {
  const failedPrompt = "[e2e:error] Keep this user message";
  await sendMessage(page, failedPrompt);
  const errorToast = page.getByText("selected model couldn't complete the request", {
    exact: false,
  });
  await expect(errorToast).toBeVisible();
  const failedUserTurn = userMessage(page, failedPrompt);
  await expect(failedUserTurn).toBeVisible();
  await failedUserTurn.hover();
  await expect(failedUserTurn.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").click();
  await expect(errorToast).toBeHidden({ timeout: 10_000 });

  await sendMessage(page, "Recovery prompt", "Stub response: Recovery prompt");
  await expect(userMessage(page, failedPrompt)).toBeVisible();
  expect(conversationRequests(runtime)).toHaveLength(2);
});

test("rapid double submission creates one user turn and one runtime run", async ({ page }) => {
  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  await composer.fill("One submission only");
  await page.getByRole("button", { name: "Send message" }).dblclick();
  await expect(assistantMessage(page, "Stub response: One submission only")).toBeVisible();
  await expect(userMessage(page, "One submission only")).toHaveCount(1);
  expect(conversationRequests(runtime)).toHaveLength(1);
});

test("large bodies are hydrated from object storage rather than truncated previews", async ({
  page,
}) => {
  const largePrompt = `Large body ${"0123456789abcdef".repeat(400)} [reply:Large body stored]`;
  await sendMessage(page, largePrompt, "Large body stored");
  expect(runtime.blobs.size).toBeGreaterThanOrEqual(2);

  await page.reload();
  await expect(userMessage(page, largePrompt)).toBeVisible();
  await expect(assistantMessage(page, "Large body stored")).toBeVisible();
});
