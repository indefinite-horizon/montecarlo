/** Prompt, selection, and nested branch creation semantics. */

import { expect, test } from "@playwright/test";
import {
  type ControlledRuntimeStream,
  conversationRequests,
  installControlledRuntimeStream,
  installRuntimeMock,
  type RuntimeMock,
  titleRequests,
} from "../helpers/runtime";
import {
  assistantMessage,
  childBranchRow,
  createPromptBranch,
  createWorkspace,
  openFreshUser,
  selectAssistantText,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

let runtime: RuntimeMock;
let controlledStream: ControlledRuntimeStream;
let activeWorkspaceName: string;

test.beforeEach(async ({ context, page }) => {
  runtime = await installRuntimeMock(context);
  controlledStream = await installControlledRuntimeStream(context);
  await openFreshUser(page, "branch-create");
  activeWorkspaceName = `Branch workspace ${Date.now()}`;
  await createWorkspace(page, activeWorkspaceName);
});

test("branch map shows response activity without shifting the branch title", async ({ page }) => {
  const prompt = `Waiting child ${controlledStream.marker}`;
  await createPromptBranch(page, prompt);
  await controlledStream.waitForRequest(page);

  const branch = childBranchRow(page, prompt);
  const title = branch.getByTestId("branch-map-title");
  await expect(branch).toHaveAttribute("aria-busy", "true");
  await expect(branch.getByTestId("branch-response-spinner")).toBeVisible();
  const waitingTitleBounds = await title.boundingBox();

  await controlledStream.finish(page);
  await expect(branch).toHaveAttribute("aria-busy", "false");
  await expect(branch.getByTestId("branch-response-spinner")).toHaveCount(0);
  const completedTitleBounds = await title.boundingBox();
  if (!waitingTitleBounds || !completedTitleBounds) throw new Error("Could not measure title.");
  expect(completedTitleBounds.x).toBe(waitingTitleBounds.x);
  expect(completedTitleBounds.y).toBe(waitingTitleBounds.y);
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
  const divider = page.getByTestId("branch-origin-divider");
  await expect(divider).toHaveText(/Branched from parent/u);
  await expect(divider.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/u);
  const parentBounds = await assistantMessage(
    page,
    "Stub response: Parent-only turn",
  ).boundingBox();
  const dividerBounds = await divider.boundingBox();
  const childBounds = await userMessage(page, "Child-only direction").boundingBox();
  expect(parentBounds?.y).toBeLessThan(dividerBounds?.y ?? 0);
  expect(dividerBounds?.y).toBeLessThan(childBounds?.y ?? 0);

  await page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]').click();
  await expect(divider).toHaveCount(0);
  await expect(userMessage(page, "Parent-only turn")).toBeVisible();
  await expect(userMessage(page, "Child-only direction")).toHaveCount(0);
});

test("highlighted passage uses the default follow-up when the optional prompt is empty", async ({
  page,
}) => {
  const response = `Good candidates include:

- A table for mappings
- A flow for sequence`;
  await sendMessage(page, `[reply:${response}] Show candidates`, "Good candidates include:");

  const document = page
    .locator('[role="document"]')
    .filter({ hasText: "Good candidates include:" })
    .last();
  const selectedText = await document.evaluate((element) => {
    const sourceText = element.querySelector("p [data-markdown-source-start]")?.firstChild;
    if (!(sourceText instanceof Text)) {
      throw new Error("Could not resolve the screenshot-matching selection text.");
    }
    const word = "candidates";
    const wordStart = sourceText.data.indexOf(word);
    if (wordStart < 0) throw new Error("Could not find candidates in the response.");

    const range = window.document.createRange();
    range.setStart(sourceText, wordStart + word.length - 2);
    range.setEnd(sourceText, wordStart + word.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return selection?.toString();
  });

  expect(selectedText).toBe("es");
  const action = page.getByTestId("selection-follow-up-action");
  await expect(action).toHaveAccessibleName("Ask Follow-up");
  await expect(action).toBeVisible();
  await action.click();
  const dialog = page.getByRole("dialog", { name: "Ask Follow-up" });
  await expect(dialog.locator("blockquote")).toHaveText("“es”");
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(page.getByText("Following a branch from", { exact: true })).toBeVisible();
  await expect(page.getByText("“es”", { exact: true })).toBeVisible();
  await expect(userMessage(page, "Expand on this further")).toBeVisible();
  await expect(assistantMessage(page, "Stub response: Expand on this further")).toBeVisible();
  expect(conversationRequests(runtime).at(-1)?.messages.at(-1)).toEqual({
    role: "user",
    content: "Expand on this further",
  });
});

for (const storageMode of ["local"] as const) {
  test(`selections beyond the metadata preview persist in ${storageMode} workspaces`, async ({
    page,
  }) => {
    const lateSelection = `late hydrated anchor ${Date.now()}`;
    const prompt = `${"Earlier hydrated message content. ".repeat(40)}${lateSelection}`;
    await sendMessage(page, prompt, lateSelection);

    const message = page.locator('[role="document"]').filter({ hasText: lateSelection }).last();
    const sourceStart = await message.evaluate((element, selectedText) => {
      const sourceElement = Array.from(
        element.querySelectorAll<HTMLElement>("[data-markdown-source-start]"),
      ).find((candidate) => candidate.textContent?.includes(selectedText));
      if (!sourceElement) throw new Error("Could not resolve selected text source position.");
      const sourceOffset = Number(sourceElement.dataset.markdownSourceStart);
      return sourceOffset + (sourceElement.textContent?.indexOf(selectedText) ?? -1);
    }, lateSelection);
    expect(sourceStart).toBeGreaterThan(1_000);

    await selectAssistantText(page, lateSelection);
    const selectedText = await page.evaluate(() => window.getSelection()?.toString().trim() ?? "");
    expect(selectedText).toContain("late hydrated anchor");
    const action = page.getByTestId("selection-follow-up-action");
    await expect(action).toBeVisible();
    // This test selects a hydrated range programmatically so it can reach far
    // beyond the preview boundary without coupling the assertion to scrolling.
    await action.evaluate((button: HTMLButtonElement) => button.click());
    const dialog = page.getByRole("dialog", { name: "Ask Follow-up" });
    await expect(dialog.locator("blockquote")).toContainText(selectedText);
    await dialog.getByRole("button", { name: "Create branch" }).click();
    await expect(page.getByText("Following a branch from", { exact: true })).toBeVisible();
  });
}

test("highlighted passage accepts a non-empty optional follow-up", async ({ page }) => {
  await sendMessage(
    page,
    "[reply:A highlighted passage to explain] Give a selectable answer",
    "A highlighted passage to explain",
  );
  await selectAssistantText(page, "highlighted passage");
  await page.getByTestId("selection-follow-up-action").click();
  const dialog = page.getByRole("dialog", { name: "Ask Follow-up" });
  await dialog.getByLabel("Add a direction (optional)").fill("Explain this passage");
  await dialog.getByRole("button", { name: "Create branch" }).click();

  await expect(userMessage(page, "Explain this passage")).toBeVisible();
  await expect(assistantMessage(page, "Stub response: Explain this passage")).toBeVisible();
  expect(conversationRequests(runtime).at(-1)?.messages.at(-1)).toEqual({
    role: "user",
    content: "Explain this passage",
  });
});

test("auto-names a highlighted branch from its selected passage with at most seven words", async ({
  page,
}) => {
  const passage = "A detailed passage about pricing experiments across several customer segments";
  const generatedTitle = "A detailed passage about pricing experiments across";
  await sendMessage(page, `[reply:${passage}] Give a naming passage`, passage);
  await selectAssistantText(page, passage);
  await page.getByTestId("selection-follow-up-action").click();
  await page
    .getByRole("dialog", { name: "Ask Follow-up" })
    .getByRole("button", { name: "Create branch" })
    .click();

  const branch = childBranchRow(page, generatedTitle);
  await expect(branch.getByTestId("branch-map-title")).toHaveText(generatedTitle);
  expect(generatedTitle.split(/\s+/u)).toHaveLength(7);
  await expect
    .poll(() =>
      titleRequests(runtime).some((request) =>
        request.messages.some(({ content }) => content.includes(passage)),
      ),
    )
    .toBe(true);

  await page.reload();
  await expect(childBranchRow(page, generatedTitle)).toBeVisible();
});

test("structural Markdown selection boundaries preserve the visible passage", async ({ page }) => {
  const phrase = "Good candidates include:";
  const response = `### Visualizations

${phrase}

- A table for mappings
- A flow for sequence`;
  await sendMessage(page, `[reply:${response}] Show visualization options`, phrase);

  const document = page.locator('[role="document"]').filter({ hasText: phrase }).last();
  const selectedText = await document.evaluate((element) => {
    const phraseText = element.querySelector("p [data-markdown-source-start]")?.firstChild;
    const firstListItem = element.querySelector("li");
    if (!(phraseText instanceof Text) || !(firstListItem instanceof HTMLLIElement)) {
      throw new Error("Could not resolve the Markdown block-boundary selection.");
    }

    const range = window.document.createRange();
    range.setStart(phraseText, 0);
    range.setEnd(firstListItem, 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return selection?.toString().trim();
  });

  expect(selectedText).toBe(phrase);
  const action = page.getByTestId("selection-follow-up-action");
  await expect(action).toBeVisible();
  await action.click();
  const dialog = page.getByRole("dialog", { name: "Ask Follow-up" });
  await expect(dialog.locator("blockquote")).toHaveText(`“${phrase}”`);
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(page.getByText(`“${phrase}”`, { exact: true })).toBeVisible();
  await expect.poll(() => conversationRequests(runtime).length).toBe(2);
});

test("selection action hides when cleared and tracks an immediate replacement", async ({
  page,
}) => {
  const firstSelection = "earlier anchor phrase";
  const secondSelection = "replacement anchor phrase";
  await sendMessage(
    page,
    `[reply:### Selectable answer\n\nAn **${firstSelection}** starts this answer.\n\nA spacer paragraph separates the selections.\n\nThe **${secondSelection}** finishes it.] Give a selectable answer`,
    firstSelection,
  );

  await selectAssistantText(page, firstSelection);
  const action = page.getByTestId("selection-follow-up-action");
  const firstPosition = await action.boundingBox();
  if (!firstPosition) throw new Error("Could not measure the first selection action.");

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(action).toHaveCount(0);

  await selectAssistantText(page, secondSelection);
  const secondPosition = await action.boundingBox();
  if (!secondPosition) throw new Error("Could not measure the replacement selection action.");
  expect(Math.abs(secondPosition.y - firstPosition.y)).toBeGreaterThan(12);

  await action.click();
  const dialog = page.getByRole("dialog", { name: "Ask Follow-up" });
  await expect(dialog).toContainText(secondSelection);
  await expect(dialog).not.toContainText(firstSelection);
  await expect(dialog.getByRole("button", { name: "Create branch" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(page.getByText("Following a branch from", { exact: true })).toBeVisible();
  await expect(page.getByText(`“${secondSelection}”`, { exact: true })).toBeVisible();
  await expect.poll(() => conversationRequests(runtime).length).toBe(2);
});

test("selection branch with a prompt sends selection provenance in normalized context", async ({
  page,
}) => {
  await sendMessage(
    page,
    "[reply:Compare **control variates**\n\nwith stratification] Give context",
    "control variates",
  );
  const response = page.locator('[role="document"]').filter({ hasText: "control variates" }).last();
  await response.evaluate((element) => {
    const strongText = element.querySelector("strong")?.textContent;
    const paragraphs = element.querySelectorAll("p");
    const secondParagraph = paragraphs.item(1);
    const startNode = element.querySelector("strong")?.firstChild?.firstChild;
    const endNode = secondParagraph?.firstChild?.firstChild;
    if (
      strongText !== "control variates" ||
      !(startNode instanceof Text) ||
      !(endNode instanceof Text)
    ) {
      throw new Error("Could not resolve the formatted cross-block selection.");
    }
    const range = window.document.createRange();
    range.setStart(startNode, 0);
    range.setEnd(endNode, "with".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.getByTestId("selection-follow-up-action")).toBeVisible();
  await page.getByTestId("selection-follow-up-action").click();
  const dialog = page.getByRole("dialog", { name: "Ask Follow-up" });
  await expect(dialog.locator("blockquote")).toHaveText(/control variates\s+with/);
  await expect(dialog).not.toContainText("variates** with");
  await dialog.getByLabel("Add a direction (optional)").fill("Explain the tradeoff");
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(assistantMessage(page, "Stub response: Explain the tradeoff")).toBeVisible();

  const request = conversationRequests(runtime).at(-1);
  expect(
    request?.messages.some(({ content }) => content.includes("“control variates\nwith”")),
  ).toBe(true);
  expect(request?.messages.some(({ content }) => content.includes("variates** with"))).toBe(false);
  expect(request?.messages.at(-1)).toEqual({ role: "user", content: "Explain the tradeoff" });
});

test("stale selected text is cleared when the transcript scrolls", async ({ page }) => {
  await sendMessage(
    page,
    "[reply:Selection that must become stale] Give scroll selection",
    "Selection that must become stale",
  );
  await selectAssistantText(page, "must become stale");
  await page.getByTestId("transcript-scroller").dispatchEvent("scroll");
  await expect(page.getByTestId("selection-follow-up-action")).toHaveCount(0);
});

test("nested branching creates one child per action at the expected depth", async ({ page }) => {
  await createPromptBranch(page, "First-level branch");
  await createPromptBranch(page, "Second-level branch");
  const first = childBranchRow(page, "First-level branch");
  const second = childBranchRow(page, "Second-level branch");
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
