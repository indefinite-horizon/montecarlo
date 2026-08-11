/** Main-thread anchoring and reader-controlled streaming scroll behavior. */

import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  type ControlledRuntimeStream,
  installControlledRuntimeStream,
  installRuntimeMock,
} from "../helpers/runtime";
import {
  assistantMessage,
  createWorkspace,
  openFreshUser,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

let controlledStream: ControlledRuntimeStream;

test.beforeEach(async ({ context, page }) => {
  await installRuntimeMock(context);
  controlledStream = await installControlledRuntimeStream(context);
  await openFreshUser(page, "message-scroller");
  await createWorkspace(page, `Message scroller workspace ${Date.now()}`);
});

function streamSection(label: string, lineCount = 24) {
  const lines = Array.from(
    { length: lineCount },
    (_, index) => `${label} line ${index + 1}: streamed output keeps extending below the reader.`,
  );
  return `\n${lines.join("\n")}\n${label}_END`;
}

async function scrollMetrics(viewport: Locator) {
  return viewport.evaluate((element) => {
    const scroller = element as HTMLElement;
    return {
      remaining: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      scrollTop: scroller.scrollTop,
    };
  });
}

async function waitForStableScroll(viewport: Locator) {
  let previous = Number.NaN;
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const { scrollTop } = await scrollMetrics(viewport);
        stableSamples = Math.abs(scrollTop - previous) < 1 ? stableSamples + 1 : 0;
        previous = scrollTop;
        return stableSamples;
      },
      { intervals: [75] },
    )
    .toBeGreaterThanOrEqual(2);
}

function messageItem(log: Locator, message: Locator) {
  return log.locator("[data-message-id]").filter({ has: message });
}

async function normalizedAnchorOffset(viewport: Locator, log: Locator, item: Locator) {
  const [viewportBox, itemBox, paddingBlockStart] = await Promise.all([
    viewport.boundingBox(),
    item.boundingBox(),
    log.evaluate((element) => Number.parseFloat(window.getComputedStyle(element).paddingTop)),
  ]);
  if (!viewportBox || !itemBox) throw new Error("Could not measure the anchored message.");
  return itemBox.y - viewportBox.y - paddingBlockStart;
}

async function visibleHeight(viewport: Locator, item: Locator) {
  const [viewportBox, itemBox] = await Promise.all([viewport.boundingBox(), item.boundingBox()]);
  if (!viewportBox || !itemBox) throw new Error("Could not measure the visible message context.");
  const top = Math.max(viewportBox.y, itemBox.y);
  const bottom = Math.min(viewportBox.y + viewportBox.height, itemBox.y + itemBox.height);
  return Math.max(0, bottom - top);
}

async function textTop(document: Locator, text: string) {
  return document.evaluate((element, targetText) => {
    const walker = window.document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = node.textContent ?? "";
      const start = value.indexOf(targetText);
      if (start >= 0) {
        const range = window.document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + targetText.length);
        return range.getBoundingClientRect().top;
      }
      node = walker.nextNode();
    }
    throw new Error(`Could not measure text: ${targetText}`);
  }, text);
}

async function selectTextWithPointerIntent(document: Locator, text: string) {
  await document.evaluate((element, selectedText) => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );

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
        element.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            button: 0,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
        return;
      }
      node = walker.nextNode();
    }
    throw new Error(`Could not select text: ${selectedText}`);
  }, text);
}

async function seedOverflowingTranscript(page: Page) {
  const seed = Array.from(
    { length: 32 },
    (_, index) => `Earlier context ${index + 1}: this line makes the saved transcript scrollable.`,
  ).join("\n");
  await sendMessage(page, `${seed}\n[reply:Earlier context complete]`, "Earlier context complete");
}

test("anchors new turns, honors selection intent, and resumes following at latest", async ({
  page,
}) => {
  await seedOverflowingTranscript(page);

  const viewport = page.getByTestId("transcript-scroller");
  const log = page.getByRole("log");
  await expect(viewport).toHaveAttribute("role", "region");
  await expect(viewport).toHaveAttribute("aria-label", "Messages");
  const jumpToLatest = page.getByRole("button", { name: "Scroll to latest" });
  await expect(jumpToLatest).toBeVisible();
  await jumpToLatest.click();
  await expect.poll(async () => (await scrollMetrics(viewport)).scrollTop).toBeGreaterThan(100);
  await expect.poll(async () => (await scrollMetrics(viewport)).remaining).toBeLessThan(2);

  const prompt = `Stream a long answer ${controlledStream.marker}`;
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await controlledStream.waitForRequest(page);
  const promptMessage = userMessage(page, prompt);
  const previousMessage = assistantMessage(page, "Earlier context complete");
  const promptItem = messageItem(log, promptMessage);
  const previousItem = messageItem(log, previousMessage);
  await expect(promptMessage).toBeVisible();
  await expect(log).toHaveAttribute("aria-busy", "true");
  await expect
    .poll(async () => Math.abs((await normalizedAnchorOffset(viewport, log, promptItem)) - 64))
    .toBeLessThan(5);
  await expect.poll(async () => visibleHeight(viewport, previousItem)).toBeGreaterThan(48);

  await controlledStream.releaseText(page, streamSection("FIRST_CHUNK", 1));
  const firstChunk = assistantMessage(page, "FIRST_CHUNK_END");
  await expect(firstChunk).toBeVisible();
  await expect
    .poll(async () => Math.abs((await normalizedAnchorOffset(viewport, log, promptItem)) - 64))
    .toBeLessThan(5);
  await expect(jumpToLatest).toHaveAttribute("data-active", "false");

  const releasedPosition = (await scrollMetrics(viewport)).scrollTop;
  await selectTextWithPointerIntent(firstChunk, "FIRST_CHUNK_END");
  await expect(page.getByTestId("selection-follow-up-action")).toBeVisible();
  await expect
    .poll(async () => Math.abs((await scrollMetrics(viewport)).scrollTop - releasedPosition))
    .toBeLessThan(2);

  await controlledStream.releaseText(page, streamSection("SECOND_CHUNK"));
  await expect(assistantMessage(page, "SECOND_CHUNK_END")).toBeVisible();
  await expect
    .poll(async () => Math.abs((await scrollMetrics(viewport)).scrollTop - releasedPosition))
    .toBeLessThan(2);
  await expect.poll(async () => (await scrollMetrics(viewport)).remaining).toBeGreaterThan(200);

  await expect(jumpToLatest).toBeVisible();
  await expect(jumpToLatest).toHaveAttribute("data-active", "true");
  await viewport.hover();
  await page.mouse.wheel(0, 10_000);
  await expect.poll(async () => (await scrollMetrics(viewport)).remaining).toBeLessThan(2);
  await waitForStableScroll(viewport);

  await controlledStream.releaseText(page, streamSection("THIRD_CHUNK"));
  await expect(assistantMessage(page, "THIRD_CHUNK_END")).toBeVisible();
  await expect.poll(async () => (await scrollMetrics(viewport)).remaining).toBeLessThan(2);

  const followingPosition = (await scrollMetrics(viewport)).scrollTop;
  await viewport.hover();
  await page.mouse.wheel(0, -600);
  await expect
    .poll(async () => (await scrollMetrics(viewport)).scrollTop)
    .toBeLessThan(followingPosition - 50);
  await waitForStableScroll(viewport);
  const streamedReply = assistantMessage(page, "THIRD_CHUNK_END");
  const wheelReleasedMarkerTop = await textTop(streamedReply, "SECOND_CHUNK_END");
  await controlledStream.releaseText(page, streamSection("FOURTH_CHUNK"));
  await expect(assistantMessage(page, "FOURTH_CHUNK_END")).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs((await textTop(streamedReply, "SECOND_CHUNK_END")) - wheelReleasedMarkerTop),
    )
    .toBeLessThan(2);
  await expect.poll(async () => (await scrollMetrics(viewport)).remaining).toBeGreaterThan(200);
  await expect(jumpToLatest).toHaveAttribute("data-active", "true");

  await jumpToLatest.click();
  await expect.poll(async () => (await scrollMetrics(viewport)).remaining).toBeLessThan(2);
  await controlledStream.releaseText(page, streamSection("FIFTH_CHUNK", 8));
  await expect(assistantMessage(page, "FIFTH_CHUNK_END")).toBeVisible();
  await expect.poll(async () => (await scrollMetrics(viewport)).remaining).toBeLessThan(2);

  await controlledStream.finish(page);
  await expect(log).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
});
