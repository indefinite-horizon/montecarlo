/** Canvas rendering, ancestry highlighting, and in-canvas follow-up journeys. */

import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  type ControlledRuntimeStream,
  conversationRequests,
  installControlledRuntimeStream,
  installRuntimeMock,
  type RuntimeMock,
} from "../helpers/runtime";
import { captureScreenshot } from "../helpers/screenshots";
import {
  activeChatRow,
  assistantMessage,
  createPromptBranch,
  createWorkspace,
  openFreshUser,
  selectAssistantText,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

let runtime: RuntimeMock;
let controlledStream: ControlledRuntimeStream;

test.beforeEach(async ({ context, page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  runtime = await installRuntimeMock(context);
  controlledStream = await installControlledRuntimeStream(context);
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
  const toggle = page.getByRole("button", { name: "Canvas view", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("conversation-canvas")).toBeVisible();
}

test("keeps the branch map available while switching between thread and canvas", async ({
  page,
}) => {
  const branchMap = page.getByRole("complementary", { name: "Branch map" });
  await expect(branchMap).toBeVisible();

  await openCanvas(page);
  await expect(branchMap).toBeVisible();

  await branchMap.getByRole("button", { name: "Close branch map" }).click();
  await expect(branchMap).toHaveCount(0);
  await page.getByRole("button", { name: "Branch map" }).click();
  await expect(branchMap).toBeVisible();
  await expect(page.getByRole("button", { name: "Canvas view", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Thread view", exact: true }).click();
  await expect(branchMap).toBeVisible();
});

test("keeps an active response running while switching between thread and canvas", async ({
  page,
}) => {
  const prompt = `Keep streaming across views ${controlledStream.marker}`;
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await controlledStream.waitForRequest(page);
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();

  await openCanvas(page);
  const canvas = page.getByTestId("conversation-canvas");
  await expect(
    canvas.getByRole("article").filter({ has: page.getByText("Active") }),
  ).toHaveAttribute("aria-busy", "true");

  await controlledStream.releaseText(page, "This response survived the view change.");

  const threadToggle = page.getByRole("button", { name: "Thread view", exact: true });
  await threadToggle.click();
  await expect(threadToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect(assistantMessage(page, "This response survived the view change.")).toBeVisible();

  await controlledStream.finish(page);
  await expect(page.getByRole("button", { name: "Stop generation" })).toHaveCount(0);
  await expect(assistantMessage(page, "This response survived the view change.")).toBeVisible();
});

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
      { intervals: [100, 100, 100, 100, 100, 100] },
    )
    .toBeGreaterThanOrEqual(3);

  return viewport.evaluate((element) => element.getAttribute("style") ?? "");
}

async function scrollMetrics(viewport: Locator) {
  return viewport.evaluate((element) => {
    const scroller = element as HTMLElement;
    return {
      max: scroller.scrollHeight - scroller.clientHeight,
      remaining: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      scrollTop: scroller.scrollTop,
    };
  });
}

async function normalizedAnchorOffset(viewport: Locator, log: Locator, item: Locator) {
  const [viewportBox, itemBox, viewportHeight, paddingBlockStart] = await Promise.all([
    viewport.boundingBox(),
    item.boundingBox(),
    viewport.evaluate((element) => element.clientHeight),
    log.evaluate((element) => Number.parseFloat(window.getComputedStyle(element).paddingTop)),
  ]);
  if (!viewportBox || !itemBox) throw new Error("Could not measure the canvas turn anchor.");
  const canvasScale = viewportBox.height / viewportHeight;
  return (itemBox.y - viewportBox.y) / canvasScale - paddingBlockStart;
}

async function visibleHeight(viewport: Locator, item: Locator) {
  const [viewportBox, itemBox, viewportHeight] = await Promise.all([
    viewport.boundingBox(),
    item.boundingBox(),
    viewport.evaluate((element) => element.clientHeight),
  ]);
  if (!viewportBox || !itemBox) throw new Error("Could not measure the canvas message context.");
  const top = Math.max(viewportBox.y, itemBox.y);
  const bottom = Math.min(viewportBox.y + viewportBox.height, itemBox.y + itemBox.height);
  const canvasScale = viewportBox.height / viewportHeight;
  return Math.max(0, bottom - top) / canvasScale;
}

function streamSection(label: string, lineCount = 24) {
  const lines = Array.from(
    { length: lineCount },
    (_, index) => `${label} line ${index + 1}: this canvas response keeps growing.`,
  );
  return `\n${lines.join("\n")}\n${label}_END`;
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
  const controlVariateDetails = Array.from(
    { length: 24 },
    (_, index) =>
      `Control variate observation ${index + 1}: compare the adjusted estimator with the baseline.`,
  ).join("\n");
  await sendMessage(
    page,
    `Show a numerical control variate example\n${controlVariateDetails}\n[reply:Control variate example complete]`,
    "Control variate example complete",
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
  const branchCards = [
    [root, "Explain Monte Carlo variance"],
    [controlVariates, "Control variates path"],
    [failureAssumptions, "Failure assumptions"],
    [stratification, "Stratification path"],
  ] as const;
  await Promise.all(
    branchCards.map(async ([card, title]) => {
      const viewport = card.getByRole("region", { name: `${title} messages` });
      await expect(viewport).toHaveCount(1);
      await expect(viewport).toHaveAttribute("tabindex", "0");
      const log = viewport.getByRole("log");
      await expect(log).toHaveCount(1);
      await expect(log).toHaveAttribute("aria-relevant", "additions");
    }),
  );
  await expect(controlVariates).toContainText("Control variates path");
  await expect(controlVariates).toContainText("Stub response: Control variates path");
  await expect(controlVariates).toContainText("Show a numerical control variate example");
  await expect(controlVariates).toContainText("Control variate example complete");

  const controlViewport = controlVariates.getByRole("region");
  const controlLog = controlViewport.getByRole("log");
  const latestControlUserItem = controlLog.locator("[data-message-id]").filter({
    hasText: "Show a numerical control variate example",
  });
  const previousControlAssistantItem = controlLog.locator("[data-message-id]").filter({
    hasText: "Stub response: Control variates path",
  });
  const unaffectedViewports = [root, failureAssumptions, stratification].map((card) =>
    card.getByRole("region"),
  );
  await expect.poll(async () => (await scrollMetrics(controlViewport)).max).toBeGreaterThan(100);
  await expect
    .poll(async () =>
      Math.abs(
        (await normalizedAnchorOffset(controlViewport, controlLog, latestControlUserItem)) - 64,
      ),
    )
    .toBeLessThan(32);
  await expect
    .poll(async () => visibleHeight(controlViewport, previousControlAssistantItem))
    .toBeGreaterThan(48);
  await controlViewport.evaluate((element) => {
    (element as HTMLElement).scrollTop = 0;
  });
  await expect.poll(async () => (await scrollMetrics(controlViewport)).scrollTop).toBe(0);
  const controlJumpToLatest = controlVariates.getByRole("button", {
    name: "Scroll to latest",
  });
  await expect(controlJumpToLatest).toHaveAttribute("data-active", "true");
  const unaffectedPositions = await Promise.all(
    unaffectedViewports.map(async (viewport) => (await scrollMetrics(viewport)).scrollTop),
  );

  await controlJumpToLatest.click();
  await expect.poll(async () => (await scrollMetrics(controlViewport)).remaining).toBeLessThan(2);
  await Promise.all(
    unaffectedViewports.map(async (viewport, index) => {
      await expect
        .poll(async () => (await scrollMetrics(viewport)).scrollTop)
        .toBe(unaffectedPositions[index]);
    }),
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

test("preserves the canvas viewport when selecting another thread", async ({ page }) => {
  await createPromptBranch(page, "Canvas viewport child");
  await openCanvas(page);

  const canvas = page.getByTestId("conversation-canvas");
  const root = canvas.getByRole("article").filter({ hasNotText: "Active" });
  await expect(root).toHaveCount(1);
  await expect(root.getByText("Active", { exact: true })).toHaveCount(0);
  await root.evaluate((element) => element.setAttribute("data-e2e-selection-target", "true"));
  const selectionTarget = canvas.locator('[data-e2e-selection-target="true"]');

  await canvas.getByRole("button", { name: "Zoom in" }).click();
  await canvas.getByRole("button", { name: "Zoom in" }).click();
  const transformBeforeSelection = await waitForStableCanvasTransform(canvas);

  await canvas.evaluate((element) => element.setAttribute("data-e2e-instance", "preserved"));
  await canvas
    .locator(".react-flow__viewport")
    .evaluate((element) => element.setAttribute("data-e2e-instance", "preserved"));
  await canvas.evaluate((element) => {
    const state = { sawLoading: false };
    const inspect = () => {
      if (element.querySelector('[data-testid="canvas-loading"]')) state.sawLoading = true;
    };
    const observer = new MutationObserver(inspect);
    observer.observe(element, { childList: true, subtree: true });
    Reflect.set(element, "__canvasLoadingProbe", { observer, state });
    inspect();
  });
  await selectionTarget.click({ position: { x: 120, y: 32 } });

  await expect(selectionTarget.getByText("Active", { exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute("data-e2e-instance", "preserved");
  await expect(canvas.locator(".react-flow__viewport")).toHaveAttribute(
    "data-e2e-instance",
    "preserved",
  );
  const transformAfterSelection = await waitForStableCanvasTransform(canvas);
  const sawLoading = await canvas.evaluate((element) => {
    const probe = Reflect.get(element, "__canvasLoadingProbe") as {
      observer: MutationObserver;
      state: { sawLoading: boolean };
    };
    probe.observer.disconnect();
    return probe.state.sawLoading;
  });
  expect(sawLoading).toBe(false);
  await expect(canvas.getByTestId("canvas-loading")).toHaveCount(0);
  expect(transformAfterSelection).toBe(transformBeforeSelection);
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
  await page.getByTestId("selection-follow-up-action").click();

  const canvas = page.getByTestId("conversation-canvas");
  const dialog = canvas.getByRole("dialog", { name: "Ask Follow-up" });
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

test("keeps controlled streaming and reader follow state isolated per canvas card", async ({
  page,
}) => {
  const rootPrompt = "Canvas stream isolation root";
  await sendMessage(page, rootPrompt, `Stub response: ${rootPrompt}`);
  await openCanvas(page);

  const canvas = page.getByTestId("conversation-canvas");
  const root = canvasCard(page, rootPrompt);
  const siblingViewport = root.getByRole("region", { name: `${rootPrompt} messages` });

  await root.getByTestId("canvas-ask-follow-up").click();
  const dialog = canvas.getByRole("dialog", { name: "Ask Follow-up" });
  const prompt = `Canvas controlled stream ${controlledStream.marker}`;
  await dialog.getByLabel("Follow-up question").fill(prompt);
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await controlledStream.waitForRequest(page);

  const targetCard = canvas.getByRole("article").filter({ hasText: "Canvas controlled stream" });
  await expect(targetCard).toHaveCount(1);
  await expect(targetCard).toHaveAttribute("aria-busy", "true");
  const targetViewport = targetCard.getByRole("region");
  const targetLog = targetViewport.getByRole("log");
  const siblingPosition = (await scrollMetrics(siblingViewport)).scrollTop;
  const targetUserItem = targetLog.locator("[data-message-id]").filter({ hasText: prompt });

  await controlledStream.releaseText(page, streamSection("CANVAS_ANCHORED", 1));
  const anchoredChunk = targetCard.getByRole("document").filter({ hasText: "CANVAS_ANCHORED_END" });
  await expect(anchoredChunk).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs(await normalizedAnchorOffset(targetViewport, targetLog, targetUserItem)),
    )
    .toBeLessThan(5);
  await expect.poll(async () => (await scrollMetrics(targetViewport)).remaining).toBeLessThan(2);
  await expect
    .poll(async () => (await scrollMetrics(siblingViewport)).scrollTop)
    .toBe(siblingPosition);

  const jumpToLatest = targetCard.getByRole("button", { name: "Scroll to latest" });
  await expect(jumpToLatest).toHaveAttribute("data-active", "false");

  await controlledStream.releaseText(page, streamSection("CANVAS_FOLLOWED"));
  const followedChunk = targetCard.getByRole("document").filter({ hasText: "CANVAS_FOLLOWED_END" });
  await expect(followedChunk).toBeVisible();
  await expect.poll(async () => (await scrollMetrics(targetViewport)).remaining).toBeLessThan(2);

  const releasedPosition = (await scrollMetrics(targetViewport)).scrollTop;
  await selectTextWithPointerIntent(followedChunk, "CANVAS_FOLLOWED line 2");
  await expect(page.getByTestId("selection-follow-up-action")).toBeVisible();
  await expect
    .poll(async () => Math.abs((await scrollMetrics(targetViewport)).scrollTop - releasedPosition))
    .toBeLessThan(2);

  await controlledStream.releaseText(page, streamSection("CANVAS_OFFSCREEN"));
  await expect(
    targetCard.getByRole("document").filter({ hasText: "CANVAS_OFFSCREEN_END" }),
  ).toBeVisible();
  await expect
    .poll(async () => Math.abs((await scrollMetrics(targetViewport)).scrollTop - releasedPosition))
    .toBeLessThan(2);
  await expect
    .poll(async () => (await scrollMetrics(targetViewport)).remaining)
    .toBeGreaterThan(200);
  await expect
    .poll(async () => (await scrollMetrics(siblingViewport)).scrollTop)
    .toBe(siblingPosition);

  await expect(jumpToLatest).toHaveAttribute("data-active", "true");
  await jumpToLatest.click();
  await expect.poll(async () => (await scrollMetrics(targetViewport)).remaining).toBeLessThan(2);

  await controlledStream.releaseText(page, streamSection("CANVAS_RESUMED", 8));
  await expect(
    targetCard.getByRole("document").filter({ hasText: "CANVAS_RESUMED_END" }),
  ).toBeVisible();
  await expect.poll(async () => (await scrollMetrics(targetViewport)).remaining).toBeLessThan(2);
  await expect
    .poll(async () => (await scrollMetrics(siblingViewport)).scrollTop)
    .toBe(siblingPosition);

  await controlledStream.finish(page);
  await expect(targetLog).not.toHaveAttribute("aria-busy", "true");
  await expect(targetCard).toHaveAttribute("aria-busy", "false");
});

test("keeps a canvas completion unread while its message is panned offscreen", async ({ page }) => {
  const chatId = await activeChatRow(page).getAttribute("data-chat-id");
  if (!chatId) throw new Error("The active chat row was missing its public ID.");
  await openCanvas(page);

  const prompt = `Complete outside the canvas ${controlledStream.marker}`;
  const canvas = page.getByTestId("conversation-canvas");
  await canvas.getByTestId("canvas-ask-follow-up").click();
  const dialog = canvas.getByRole("dialog", { name: "Ask Follow-up" });
  await dialog.getByLabel("Follow-up question").fill(prompt);
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await controlledStream.waitForRequest(page);
  await controlledStream.releaseText(page, "This canvas response will finish offscreen.");

  const response = canvas
    .getByRole("document")
    .filter({ hasText: "This canvas response will finish offscreen." });
  await expect(response).toBeVisible();
  const pane = canvas.locator(".react-flow__pane");
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Could not measure the ReactFlow pane.");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.mouse.move(paneBox.x + paneBox.width - 80, paneBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(paneBox.x + 20, paneBox.y + 80, { steps: 12 });
    await page.mouse.up();
  }

  await expect
    .poll(async () => {
      const [canvasBox, responseBox] = await Promise.all([
        canvas.boundingBox(),
        response.boundingBox(),
      ]);
      return Boolean(canvasBox && responseBox && responseBox.x + responseBox.width <= canvasBox.x);
    })
    .toBe(true);

  await controlledStream.finish(page);
  const row = page.locator(`[data-testid="chat-row"][data-chat-id="${chatId}"]`);
  await expect(row).toHaveAttribute("data-unread", "true");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.mouse.move(paneBox.x + 20, paneBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(paneBox.x + paneBox.width - 80, paneBox.y + 80, { steps: 12 });
    await page.mouse.up();
  }
  await expect
    .poll(async () => {
      const [canvasBox, responseBox] = await Promise.all([
        canvas.boundingBox(),
        response.boundingBox(),
      ]);
      return Boolean(
        canvasBox &&
          responseBox &&
          responseBox.x + responseBox.width > canvasBox.x &&
          responseBox.x < canvasBox.x + canvasBox.width,
      );
    })
    .toBe(true);
  await expect(row).toHaveAttribute("data-unread", "false");
});
