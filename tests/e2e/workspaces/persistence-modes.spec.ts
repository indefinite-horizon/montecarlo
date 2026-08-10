/** Equivalent durable conversation journeys across local and cloud workspace storage. */

import { expect, type Locator, test } from "@playwright/test";
import { installRuntimeMock, type RuntimeMock } from "../helpers/runtime";
import {
  assistantMessage,
  createChat,
  createProject,
  createWorkspace,
  openFreshUser,
  sendMessage,
  userMessage,
  workspaceButton,
} from "../helpers/workspace";

const storageCases = [
  {
    mode: "local",
    label: "local-storage",
    backend: "filesystem",
    status: "Files on this device",
  },
  {
    mode: "cloud",
    label: "cloud-storage",
    backend: "r2",
    status: "Cloud file storage",
  },
] as const;

let runtime: RuntimeMock;

async function normalizedAnchorOffset(viewport: Locator, log: Locator, item: Locator) {
  const [viewportBox, itemBox, paddingBlockStart] = await Promise.all([
    viewport.boundingBox(),
    item.boundingBox(),
    log.evaluate((element) => Number.parseFloat(window.getComputedStyle(element).paddingTop)),
  ]);
  if (!viewportBox || !itemBox) throw new Error("Could not measure the saved turn anchor.");
  return itemBox.y - viewportBox.y - paddingBlockStart;
}

async function visibleHeight(viewport: Locator, item: Locator) {
  const [viewportBox, itemBox] = await Promise.all([viewport.boundingBox(), item.boundingBox()]);
  if (!viewportBox || !itemBox) throw new Error("Could not measure the saved message context.");
  const top = Math.max(viewportBox.y, itemBox.y);
  const bottom = Math.min(viewportBox.y + viewportBox.height, itemBox.y + itemBox.height);
  return Math.max(0, bottom - top);
}

test.beforeEach(async ({ context }) => {
  runtime = await installRuntimeMock(context);
});

for (const storage of storageCases) {
  test(`${storage.label} workspace persists the durable conversation journey`, async ({ page }) => {
    await openFreshUser(page, `persistence-${storage.mode}`);
    const suffix = Date.now();
    const workspaceName = `${storage.label} workspace ${suffix}`;
    const projectName = `${storage.label} project ${suffix}`;
    const previousReply = `${storage.label} previous context is ready`;
    const previousPrompt = `${storage.label} earlier turn [reply:${previousReply}]`;
    const latestReply = `${storage.label} latest turn is ready`;
    const latestPrompt = `${storage.label} ${"latest-persistence-chunk ".repeat(
      100,
    )}[reply:${latestReply}]`;

    await createWorkspace(page, workspaceName, storage.mode);
    await expect(page.getByText(storage.status, { exact: true })).toBeVisible();
    await createProject(page, projectName);
    await createChat(page, projectName);
    await sendMessage(page, previousPrompt, previousReply);
    await sendMessage(page, latestPrompt, latestReply);

    expect(new Set(runtime.blobBackends.values())).toEqual(new Set([storage.backend]));
    expect(runtime.blobs.size).toBeGreaterThanOrEqual(4);

    runtime.blobReads.length = 0;
    await page.reload();
    await expect(page.getByTestId("workspace-app")).toBeVisible();
    await expect(workspaceButton(page, workspaceName)).toBeVisible();
    await expect(page.getByText(storage.status, { exact: true })).toBeVisible();
    await workspaceButton(page, workspaceName).click();
    const workspaceMenu = page.getByRole("menu", { name: "Workspaces" });
    await expect(workspaceMenu).toBeVisible();
    await expect(
      workspaceMenu.getByRole("menuitem").filter({ hasText: workspaceName }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const projectSection = page
      .getByRole("navigation", { name: "Projects and chats" })
      .locator("section")
      .filter({ hasText: projectName });
    await expect(projectSection.getByTestId("chat-row")).toHaveCount(1);
    const persistedUserMessage = userMessage(page, latestPrompt);
    const persistedPreviousAssistant = assistantMessage(page, previousReply);
    await expect(persistedPreviousAssistant).toBeVisible();
    await expect(persistedUserMessage).toBeVisible();
    await expect(assistantMessage(page, latestReply)).toBeVisible();
    const viewport = page.getByTestId("transcript-scroller");
    const log = viewport.getByRole("log");
    const persistedUserItem = log.locator("[data-message-id]").filter({
      has: persistedUserMessage,
    });
    const persistedPreviousAssistantItem = log.locator("[data-message-id]").filter({
      has: persistedPreviousAssistant,
    });
    await expect
      .poll(async () =>
        Math.abs((await normalizedAnchorOffset(viewport, log, persistedUserItem)) - 64),
      )
      .toBeLessThan(5);
    await expect
      .poll(async () => visibleHeight(viewport, persistedPreviousAssistantItem))
      .toBeGreaterThan(48);
    await expect
      .poll(() =>
        viewport.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeGreaterThan(200);
    await expect.poll(() => runtime.blobReads.length).toBeGreaterThanOrEqual(4);
    expect(new Set(runtime.blobReads.map((read) => read.backend))).toEqual(
      new Set([storage.backend]),
    );
  });
}

test("persisted blob timeout opens the saved turn with its preview fallback", async ({ page }) => {
  await openFreshUser(page, "persistence-timeout");
  const suffix = Date.now();
  const workspaceName = `timeout fallback workspace ${suffix}`;
  const previousReply = "Previous context remains visible above the fallback turn";
  const previewMarker = `Saved preview fallback ${suffix}`;
  const fullContentOnlyMarker = `FULL_CONTENT_AFTER_PREVIEW_${suffix}`;
  const latestReply = "The fallback turn has a saved assistant response";
  const previewHeight = Array.from(
    { length: 100 },
    (_, index) => `preview fallback row ${index + 1}`,
  ).join("\n");
  const latestPrompt = `${previewMarker}\n${previewHeight}\n${fullContentOnlyMarker}\n[reply:${latestReply}]`;

  await createWorkspace(page, workspaceName);
  await sendMessage(page, `Earlier timeout context [reply:${previousReply}]`, previousReply);
  await sendMessage(page, latestPrompt, latestReply);

  let delayedBlobReads = 0;
  let completedDelayedBlobReads = 0;
  await page.route("**/v1/blobs/**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    delayedBlobReads += 1;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.fallback().catch(() => undefined);
    completedDelayedBlobReads += 1;
  });

  await page.reload();
  await expect(page.getByTestId("workspace-app")).toBeVisible();
  await expect.poll(() => delayedBlobReads).toBeGreaterThan(0);

  const viewport = page.getByTestId("transcript-scroller");
  const log = viewport.getByRole("log");
  await expect(log).toHaveAttribute("aria-busy", "true", { timeout: 1_000 });

  const previewUserMessage = userMessage(page, previewMarker);
  await expect(previewUserMessage).toBeVisible({ timeout: 5_000 });
  await expect(log).not.toHaveAttribute("aria-busy", "true");
  await expect.poll(() => completedDelayedBlobReads).toBeGreaterThan(0);
  await expect(log).not.toContainText(fullContentOnlyMarker);

  const previewUserItem = log.locator("[data-message-id]").filter({
    has: previewUserMessage,
  });
  const previousAssistantItem = log.locator("[data-message-id]").filter({
    has: assistantMessage(page, previousReply),
  });
  await expect
    .poll(async () => Math.abs((await normalizedAnchorOffset(viewport, log, previewUserItem)) - 64))
    .toBeLessThan(5);
  await expect.poll(async () => visibleHeight(viewport, previousAssistantItem)).toBeGreaterThan(48);
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeGreaterThan(100);
});
