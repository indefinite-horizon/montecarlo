/** Session-only viewport and reader-position restoration for Canvas. */

import { expect, type Locator, test } from "@playwright/test";
import { installRuntimeMock } from "../helpers/runtime";
import { createWorkspace, openFreshUser, sendMessage } from "../helpers/workspace";

test.beforeEach(async ({ context, page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installRuntimeMock(context);
  await openFreshUser(page, "canvas-presentation-memory");
  await createWorkspace(page, `Canvas memory workspace ${Date.now()}`);
});

async function openCanvas(page: import("@playwright/test").Page) {
  const toggle = page.getByRole("button", { name: "Canvas view", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("conversation-canvas")).toBeVisible();
}

async function waitForStableCanvasTransform(canvas: Locator) {
  const viewport = canvas.locator(".react-flow__viewport");
  let previousTransform: string | undefined;
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const transform = await viewport.evaluate((element) => element.getAttribute("style") ?? "");
        stableSamples = transform === previousTransform ? stableSamples + 1 : 0;
        previousTransform = transform;
        return stableSamples;
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(3);
  return viewport.evaluate((element) => element.getAttribute("style") ?? "");
}

async function scrollMetrics(viewport: Locator) {
  return viewport.evaluate((element) => {
    const scroller = element as HTMLElement;
    return {
      max: scroller.scrollHeight - scroller.clientHeight,
      scrollTop: scroller.scrollTop,
    };
  });
}

async function setReaderScrollPosition(viewport: Locator, fraction: number) {
  const target = await viewport.evaluate((element, targetFraction) => {
    const scroller = element as HTMLElement;
    const max = scroller.scrollHeight - scroller.clientHeight;
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1 }));
    scroller.scrollTop = max * targetFraction;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
    return max * targetFraction;
  }, fraction);
  await expect
    .poll(async () => Math.abs((await scrollMetrics(viewport)).scrollTop - target))
    .toBeLessThan(2);
}

async function messageAnchor(viewport: Locator) {
  return viewport.evaluate((element) => {
    const viewportRect = element.getBoundingClientRect();
    const scale = viewportRect.height / (element as HTMLElement).clientHeight;
    const item = Array.from(element.querySelectorAll<HTMLElement>("[data-message-id]")).find(
      (candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
      },
    );
    if (!item?.dataset.messageId)
      throw new Error("Could not find a visible Canvas message anchor.");
    return {
      messageId: item.dataset.messageId,
      offset: (item.getBoundingClientRect().top - viewportRect.top) / scale,
    };
  });
}

async function anchorOffset(viewport: Locator, messageId: string) {
  return viewport.evaluate((element, targetMessageId) => {
    const viewportRect = element.getBoundingClientRect();
    const scale = viewportRect.height / (element as HTMLElement).clientHeight;
    const item = Array.from(element.querySelectorAll<HTMLElement>("[data-message-id]")).find(
      (candidate) => candidate.dataset.messageId === targetMessageId,
    );
    if (!item) throw new Error(`Could not find restored Canvas anchor: ${targetMessageId}`);
    return (item.getBoundingClientRect().top - viewportRect.top) / scale;
  }, messageId);
}

test("restores a zoomed viewport and card reader position after remount", async ({ page }) => {
  const longPrompt = Array.from(
    { length: 36 },
    (_, index) => `Canvas memory line ${index + 1}: keep this branch card independently readable.`,
  ).join("\n");
  await sendMessage(
    page,
    `${longPrompt}\n[reply:Canvas memory complete]`,
    "Canvas memory complete",
  );
  await openCanvas(page);

  let canvas = page.getByTestId("conversation-canvas");
  const defaultTransform = await waitForStableCanvasTransform(canvas);
  await canvas.getByRole("button", { name: "Zoom in" }).click();
  await canvas.getByRole("button", { name: "Zoom in" }).click();
  const savedTransform = await waitForStableCanvasTransform(canvas);
  expect(savedTransform).not.toBe(defaultTransform);

  let cardViewport = canvas.getByRole("article").getByRole("region");
  await expect.poll(async () => (await scrollMetrics(cardViewport)).max).toBeGreaterThan(100);
  await setReaderScrollPosition(cardViewport, 0.42);
  const savedAnchor = await messageAnchor(cardViewport);

  const threadToggle = page.getByRole("button", { name: "Thread view", exact: true });
  await threadToggle.click();
  await expect(threadToggle).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveCount(0);
  await openCanvas(page);

  canvas = page.getByTestId("conversation-canvas");
  expect(await waitForStableCanvasTransform(canvas)).toBe(savedTransform);
  cardViewport = canvas.getByRole("article").getByRole("region");
  await expect
    .poll(async () =>
      Math.abs((await anchorOffset(cardViewport, savedAnchor.messageId)) - savedAnchor.offset),
    )
    .toBeLessThan(5);
});
