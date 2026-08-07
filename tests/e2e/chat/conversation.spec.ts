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
  page,
}) => {
  await sendMessage(
    page,
    "Explain deterministic sampling",
    "Stub response: Explain deterministic sampling",
  );
  await expect.poll(() => titleRequests(runtime).length).toBe(1);
  expect(conversationRequests(runtime)).toHaveLength(1);
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
});

test("stops an in-progress generation and ignores its late response", async ({ page }) => {
  const prompt = "[e2e:slow] Cancel this generation";
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect.poll(() => conversationRequests(runtime).length).toBe(1);
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect(userMessage(page, prompt)).toBeVisible();
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
  const errorToast = page.getByText("local model runtime is offline", { exact: false });
  await expect(errorToast).toBeVisible();
  await expect(userMessage(page, failedPrompt)).toBeVisible();
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
