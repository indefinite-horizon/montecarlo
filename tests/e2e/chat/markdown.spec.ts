/** Semantic, safety, persistence, and canvas coverage for model-authored Markdown. */

import { expect, test } from "@playwright/test";
import {
  type ControlledRuntimeStream,
  installControlledRuntimeStream,
  installRuntimeMock,
} from "../helpers/runtime";
import { createWorkspace, openFreshUser, sendMessage } from "../helpers/workspace";

let controlledStream: ControlledRuntimeStream;

test.beforeEach(async ({ context, page }) => {
  await page.setViewportSize({ width: 1500, height: 960 });
  await installRuntimeMock(context);
  controlledStream = await installControlledRuntimeStream(context, "[e2e:markdown]");
  await openFreshUser(page, "markdown");
  await createWorkspace(page, `Markdown workspace ${Date.now()}`);
});

test("renders safe GFM semantics through streaming, persistence, and canvas views", async ({
  page,
}) => {
  const openingChunk = "# Markdown matrix\n\nA streamed **frag";
  const closingChunk = `ment** with *emphasis* and ~~old copy~~.

## Lists

- First bullet
  - Nested bullet
- [x] Finished task
- [ ] Open task

1. First step
2. Second step

> A quoted conclusion.

[Safe link](https://example.com/docs) and <https://example.org/auto>.

[Unsafe link](javascript:alert(1))

| Method | Score |
| :--- | ---: |
| Baseline | 0.72 |
| Improved | 0.91 |

Inline code: \`const total = 2;\`

\`\`\`ts
const result = rows.map((row) => row.score);
\`\`\`

First line  
Second line

---

A claim with a footnote.[^1]

[^1]: Supporting detail.

![Plot preview](https://example.com/plot.png)

[![Linked badge](https://example.com/badge.png)](https://example.com/project)

Raw <strong onclick="globalThis.markdownUnsafe = true">HTML</strong> stays inert.

<script>globalThis.markdownUnsafe = true</script>`;

  const composer = page.getByPlaceholder("Ask a follow-up or start a new direction…");
  await composer.fill(`${controlledStream.marker} Render the Markdown fixture`);
  await page.getByRole("button", { name: "Send message" }).click();
  await controlledStream.waitForRequest(page);
  await controlledStream.releaseText(page, openingChunk);

  const response = page
    .getByRole("article", { name: "Monte Carlo", exact: true })
    .locator('[role="document"]');
  await expect(response).toContainText("A streamed");

  await controlledStream.releaseText(page, closingChunk);
  await controlledStream.finish(page);
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

  await expect(response.getByRole("heading", { level: 1, name: "Markdown matrix" })).toBeVisible();
  await expect(response.getByRole("heading", { level: 2, name: "Lists" })).toBeVisible();
  await expect(response.locator("strong")).toHaveText("fragment");
  await expect(response.locator("em")).toHaveText("emphasis");
  await expect(response.locator("del")).toHaveText("old copy");
  await expect(response.getByRole("list")).toHaveCount(3);
  await expect(response.getByRole("listitem").filter({ hasText: "Nested bullet" })).toBeVisible();
  await expect(response.getByRole("checkbox")).toHaveCount(2);
  await expect(response.getByRole("checkbox").first()).toBeChecked();
  await expect(response.getByRole("checkbox").first()).toBeDisabled();
  await expect(response.locator("blockquote")).toContainText("A quoted conclusion.");

  const safeLink = response.getByRole("link", { name: "Safe link" });
  await expect(safeLink).toHaveAttribute("href", "https://example.com/docs");
  await expect(safeLink).toHaveAttribute("target", "_blank");
  await expect(safeLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(response.getByRole("link", { name: "https://example.org/auto" })).toHaveAttribute(
    "href",
    "https://example.org/auto",
  );
  await expect(response.getByText("Unsafe link", { exact: true })).not.toHaveAttribute("href");

  const table = response.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Method" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "0.91" })).toBeVisible();
  await expect(response.locator("code").filter({ hasText: "const total = 2;" })).toBeVisible();
  await expect(response.locator("pre code.language-ts")).toContainText("rows.map");
  await expect(response.locator("br")).toHaveCount(1);
  await expect(response.locator("hr")).toHaveCount(1);
  await expect(response.locator("[data-footnotes]")).toContainText("Supporting detail.");
  await expect(response.locator("[data-footnote-ref]")).toHaveAttribute(
    "href",
    /^#markdown-.+-fn-1$/,
  );
  await expect(response.getByRole("link", { name: "Open image: Plot preview" })).toHaveAttribute(
    "href",
    "https://example.com/plot.png",
  );
  await expect(response.getByRole("link", { name: "Open image: Linked badge" })).toHaveAttribute(
    "href",
    "https://example.com/project",
  );
  await expect(response.locator("a a")).toHaveCount(0);
  await expect(response.locator("img")).toHaveCount(0);
  await expect(response.locator("script, [onclick], [onerror]")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, "markdownUnsafe")))
    .toBe(undefined);
  await expect(response).toContainText("Raw HTML stays inert.");

  await page.reload();
  const persistedResponse = page
    .getByRole("article", { name: "Monte Carlo", exact: true })
    .locator('[role="document"]');
  await expect(
    persistedResponse.getByRole("heading", { level: 1, name: "Markdown matrix" }),
  ).toBeVisible();
  await expect(persistedResponse.getByRole("table")).toBeVisible();

  await page.getByRole("button", { name: "Canvas view" }).click();
  const canvas = page.getByTestId("conversation-canvas");
  await expect(canvas.getByRole("heading", { level: 1, name: "Markdown matrix" })).toBeVisible();
  await expect(canvas.getByRole("table")).toBeVisible();
  await expect(canvas.getByRole("link", { name: "Safe link" })).toHaveAttribute(
    "href",
    "https://example.com/docs",
  );
});

test("scopes footnote targets to each assistant message", async ({ page }) => {
  await sendMessage(
    page,
    "First note.[^1]\n\n[^1]: First supporting detail.",
    "Stub response: First note.",
  );
  await sendMessage(
    page,
    "Second note.[^1]\n\n[^1]: Second supporting detail.",
    "Stub response: Second note.",
  );

  const documents = page
    .getByRole("article", { name: "Monte Carlo", exact: true })
    .locator('[role="document"]');
  await expect(documents).toHaveCount(2);

  const firstReference = documents.nth(0).locator("[data-footnote-ref]");
  const secondReference = documents.nth(1).locator("[data-footnote-ref]");
  const firstHref = await firstReference.getAttribute("href");
  const secondHref = await secondReference.getAttribute("href");
  expect(firstHref).toMatch(/^#markdown-.+-fn-1$/);
  expect(secondHref).toMatch(/^#markdown-.+-fn-1$/);
  expect(secondHref).not.toBe(firstHref);

  await expect(documents.nth(0).locator("[data-footnotes] li").first()).toHaveAttribute(
    "id",
    firstHref?.slice(1) ?? "missing-footnote",
  );
  await expect(documents.nth(1).locator("[data-footnotes] li").first()).toHaveAttribute(
    "id",
    secondHref?.slice(1) ?? "missing-footnote",
  );
  await secondReference.click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(secondHref);
});
