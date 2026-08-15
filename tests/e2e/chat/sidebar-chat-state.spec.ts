/** Per-chat response activity and durable viewport-aware unread state. */

import { expect, type Page, test } from "@playwright/test";
import {
  type ControlledRuntimeStream,
  installControlledRuntimeStream,
  installRuntimeMock,
} from "../helpers/runtime";
import {
  activeChatRow,
  assistantMessage,
  childBranchRow,
  createChat,
  createPromptBranch,
  createWorkspace,
  openFreshUser,
  userMessage,
} from "../helpers/workspace";

let controlledStream: ControlledRuntimeStream;

test.beforeEach(async ({ context, page }) => {
  await installRuntimeMock(context);
  controlledStream = await installControlledRuntimeStream(context);
  await openFreshUser(page, "sidebar-chat-state");
});

function chatRow(page: Page, publicId: string) {
  return page
    .getByRole("navigation", { name: "Projects and chats" })
    .locator(`[data-testid="chat-row"][data-chat-id="${publicId}"]`);
}

async function publicIdForActiveChat(page: Page): Promise<string> {
  const publicId = await activeChatRow(page).getAttribute("data-chat-id");
  if (!publicId) throw new Error("The active chat row was missing its public ID.");
  return publicId;
}

test("keeps a chat unread until its completed branch message enters the viewport", async ({
  page,
}) => {
  await createWorkspace(page, `Branch unread state ${Date.now()}`);
  const chatId = await publicIdForActiveChat(page);
  const prompt = `Hidden ${controlledStream.marker}`;
  await createPromptBranch(page, prompt);
  await controlledStream.waitForRequest(page);
  const childBranch = childBranchRow(page, prompt);
  await expect(childBranch.getByTestId("branch-response-spinner")).toBeVisible();
  await expect(childBranch.getByTestId("branch-unread-indicator")).toHaveCount(0);

  await page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]').click();
  await controlledStream.releaseText(page, "Only the child branch can show this completion.");
  await controlledStream.finish(page);
  const row = chatRow(page, chatId);
  const rootBranch = page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]');
  await expect(row).toHaveAttribute("data-unread", "true");
  await expect(rootBranch).toHaveAttribute("data-unread", "false");
  await expect(rootBranch.getByTestId("branch-map-title")).toHaveClass(/font-normal/u);
  await expect(rootBranch.getByTestId("branch-map-title")).toHaveClass(/text-muted-foreground/u);
  await expect(childBranch).toHaveAttribute("data-unread", "true");
  await expect(childBranch.getByTestId("branch-map-title")).toHaveClass(/font-semibold/u);
  await expect(childBranch.getByTestId("branch-map-title")).toHaveClass(/text-foreground/u);
  await expect(childBranch.getByTestId("branch-response-spinner")).toHaveCount(0);
  await expect(childBranch.getByTestId("branch-unread-indicator")).toBeVisible();
  await expect(
    assistantMessage(page, "Only the child branch can show this completion."),
  ).toHaveCount(0);

  const rootPrompt = "Keep the child unread while sending here [e2e:slow]";
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(rootPrompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect(row).toHaveAttribute("data-unread", "true");
  await expect(childBranch).toHaveAttribute("data-unread", "true");
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect(row).toHaveAttribute("data-unread", "true");
  await expect(childBranch).toHaveAttribute("data-unread", "true");

  await childBranch.click();
  await expect(
    assistantMessage(page, "Only the child branch can show this completion."),
  ).toBeVisible();
  await expect(row).toHaveAttribute("data-unread", "false");
  await expect(childBranch).toHaveAttribute("data-unread", "false");
  await expect(childBranch.getByTestId("branch-map-title")).toHaveClass(/font-normal/u);
  await expect(childBranch.getByTestId("branch-map-title")).toHaveClass(/text-muted-foreground/u);
  await expect(childBranch.getByTestId("branch-unread-indicator")).toHaveCount(0);
});

for (const storageMode of ["local"] as const) {
  test(`shows inactive response activity and persists read state in ${storageMode} workspaces`, async ({
    page,
  }) => {
    await createWorkspace(page, `${storageMode} sidebar state ${Date.now()}`);
    const respondingChatId = await publicIdForActiveChat(page);
    await createChat(page);
    const otherChatId = await publicIdForActiveChat(page);
    const respondingChat = chatRow(page, respondingChatId);
    const otherChat = chatRow(page, otherChatId);
    await respondingChat.click();
    await expect(respondingChat.getByTestId("chat-title")).toHaveClass(/font-normal/u);
    await expect(respondingChat.getByTestId("chat-title")).toHaveClass(/text-muted-foreground/u);

    const prompt = `Complete after I leave ${controlledStream.marker}`;
    await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await controlledStream.waitForRequest(page);
    await expect(respondingChat).toHaveAttribute("data-ongoing-response", "true");
    await expect(respondingChat).toHaveAttribute("data-unread", "false");
    await expect(page.getByTestId("chat-response-spinner")).toHaveCount(1);
    const [respondingTitleBox, idleTitleBox] = await Promise.all([
      respondingChat.getByTestId("chat-title").boundingBox(),
      otherChat.getByTestId("chat-title").boundingBox(),
    ]);
    if (!respondingTitleBox || !idleTitleBox) throw new Error("Could not measure chat titles.");
    expect(Math.abs(respondingTitleBox.x - idleTitleBox.x)).toBeLessThan(1);

    await otherChat.click();
    await controlledStream.releaseText(page, "Completed while this chat was elsewhere.");
    await controlledStream.finish(page);
    await expect(respondingChat).toHaveAttribute("data-ongoing-response", "false");
    await expect(page.getByTestId("chat-response-spinner")).toHaveCount(0);
    await expect(respondingChat).toHaveAttribute("data-unread", "true");
    await expect(respondingChat.getByTestId("chat-title")).toHaveClass(/font-semibold/u);
    await expect(respondingChat.getByTestId("chat-title")).toHaveClass(/text-foreground/u);
    await respondingChat.locator(":scope > button").first().focus();
    await expect(respondingChat).toHaveCSS("box-shadow", "none");

    await respondingChat.click();
    await expect(assistantMessage(page, "Completed while this chat was elsewhere.")).toBeVisible();
    await expect(respondingChat).toHaveAttribute("data-unread", "false");
    await expect(respondingChat.getByTestId("chat-title")).toHaveClass(/font-normal/u);
    await expect(respondingChat.getByTestId("chat-title")).toHaveClass(/text-muted-foreground/u);

    await page.reload();
    await expect(chatRow(page, respondingChatId)).toHaveAttribute("data-unread", "false");
  });
}

test("does not treat canceled partial output as a new unread completion", async ({ page }) => {
  await createWorkspace(page, `Canceled sidebar state ${Date.now()}`);
  const canceledChatId = await publicIdForActiveChat(page);
  await createChat(page);
  const otherChatId = await publicIdForActiveChat(page);
  const canceledChat = chatRow(page, canceledChatId);
  await canceledChat.click();

  const prompt = `Cancel this partial response ${controlledStream.marker}`;
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await controlledStream.waitForRequest(page);
  await controlledStream.releaseText(page, "Persisted but incomplete partial output.");
  await expect(assistantMessage(page, "Persisted but incomplete partial output.")).toBeVisible();
  await expect(canceledChat).toHaveAttribute("data-unread", "false");

  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(canceledChat).toHaveAttribute("data-ongoing-response", "false");
  await chatRow(page, otherChatId).click();
  await expect(canceledChat).toHaveAttribute("data-unread", "false");

  await canceledChat.click();
  await expect(assistantMessage(page, "Persisted but incomplete partial output.")).toBeVisible();
  await expect(canceledChat).toHaveAttribute("data-unread", "false");
  await page.reload();
  await expect(chatRow(page, canceledChatId)).toHaveAttribute("data-unread", "false");
});

test("does not treat a gracefully canceled runtime response as completed", async ({ page }) => {
  await createWorkspace(page, `Graceful cancel state ${Date.now()}`);
  const canceledChatId = await publicIdForActiveChat(page);
  await createChat(page);
  const otherChatId = await publicIdForActiveChat(page);
  const canceledChat = chatRow(page, canceledChatId);
  await canceledChat.click();

  const prompt = `Gracefully cancel this response ${controlledStream.marker}`;
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await controlledStream.waitForRequest(page);
  await controlledStream.releaseText(page, "Gracefully canceled partial output.");

  await chatRow(page, otherChatId).click();
  await controlledStream.finish(page, "cancelled");
  await expect(canceledChat).toHaveAttribute("data-ongoing-response", "false");
  await expect(canceledChat).toHaveAttribute("data-unread", "false");

  await canceledChat.click();
  await expect(assistantMessage(page, "Gracefully canceled partial output.")).toBeVisible();
  await expect(canceledChat).toHaveAttribute("data-unread", "false");
});

test("does not mark a completion read behind the mobile sidebar", async ({ page }) => {
  await createWorkspace(page, `Occluded sidebar state ${Date.now()}`);
  const chatId = await publicIdForActiveChat(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  const prompt = `Complete behind the sidebar ${controlledStream.marker}`;
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await controlledStream.waitForRequest(page);

  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(chatRow(page, chatId)).toBeVisible();

  await controlledStream.releaseText(page, "This completion is hidden by the sidebar.");
  await controlledStream.finish(page);
  await expect(chatRow(page, chatId)).toHaveAttribute("data-unread", "true");

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(assistantMessage(page, "This completion is hidden by the sidebar.")).toBeVisible();
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(chatRow(page, chatId)).toHaveAttribute("data-unread", "false");
});

test("removes an empty assistant message when a response is canceled", async ({ page }) => {
  await createWorkspace(page, `Empty cancel state ${Date.now()}`);
  const canceledChatId = await publicIdForActiveChat(page);
  await createChat(page);
  const otherChatId = await publicIdForActiveChat(page);
  const canceledChat = chatRow(page, canceledChatId);
  await canceledChat.click();

  const prompt = `Cancel before output ${controlledStream.marker}`;
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await controlledStream.waitForRequest(page);
  await expect(page.locator('[role="document"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(canceledChat).toHaveAttribute("data-ongoing-response", "false");
  await chatRow(page, otherChatId).click();

  await canceledChat.click();
  await expect(userMessage(page, prompt)).toBeVisible();
  await expect(page.locator('[role="document"]')).toHaveCount(0);
  await page.reload();
  await chatRow(page, canceledChatId).click();
  await expect(userMessage(page, prompt)).toBeVisible();
  await expect(chatRow(page, canceledChatId)).toHaveAttribute("data-ongoing-response", "false");
  await expect(page.locator('[role="document"]')).toHaveCount(0);
});

test("stops a response while its durable run is still starting", async ({ page }) => {
  await createWorkspace(page, `Early stop state ${Date.now()}`);
  const chatId = await publicIdForActiveChat(page);
  const row = chatRow(page, chatId);
  const prompt = `Stop during setup ${controlledStream.marker}`;

  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Stop generation" }).click();

  await expect(row).toHaveAttribute("data-ongoing-response", "false", { timeout: 15_000 });
  await expect(userMessage(page, prompt)).toBeVisible();
  await expect(page.locator('[role="document"]')).toHaveCount(0);

  await page.reload();
  await chatRow(page, chatId).click();
  await expect(userMessage(page, prompt)).toBeVisible();
  await expect(page.locator('[role="document"]')).toHaveCount(0);
});
