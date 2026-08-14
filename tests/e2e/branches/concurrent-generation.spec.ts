/** Branch-scoped generation concurrency and cancellation. */

import { expect, test } from "@playwright/test";
import { installControlledRuntimeStream, installRuntimeMock } from "../helpers/runtime";
import {
  assistantMessage,
  childBranchRow,
  createPromptBranch,
  createWorkspace,
  openFreshUser,
  userMessage,
} from "../helpers/workspace";

test("canceling one branch generation leaves its sibling running", async ({ context, page }) => {
  await installRuntimeMock(context);
  const childStream = await installControlledRuntimeStream(context, "[e2e:child-stream]");
  const rootStream = await installControlledRuntimeStream(context, "[e2e:root-stream]");
  await openFreshUser(page, "branch-concurrency");
  await createWorkspace(page, `Branch concurrency ${Date.now()}`);

  const childPrompt = `Child response ${childStream.marker}`;
  await createPromptBranch(page, childPrompt);
  await childStream.waitForRequest(page);
  const childBranch = childBranchRow(page, childPrompt);
  await expect(childBranch.getByTestId("branch-response-spinner")).toBeVisible();

  const rootBranch = page.locator('[data-testid="branch-map-row"][data-branch-depth="0"]');
  await rootBranch.click();
  const rootPrompt = `Root response ${rootStream.marker}`;
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(rootPrompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await rootStream.waitForRequest(page);
  await expect(userMessage(page, rootPrompt)).toBeVisible();
  await expect(rootBranch.getByTestId("branch-response-spinner")).toBeVisible();
  await expect(childBranch.getByTestId("branch-response-spinner")).toBeVisible();

  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(rootBranch.getByTestId("branch-response-spinner")).toHaveCount(0);
  await expect(childBranch.getByTestId("branch-response-spinner")).toBeVisible();
  await expect(userMessage(page, rootPrompt)).toBeVisible();

  await childStream.releaseText(page, "Child response completed independently.");
  await childStream.finish(page);
  await expect(childBranch.getByTestId("branch-response-spinner")).toHaveCount(0);

  await childBranchRow(page, childPrompt).click();
  await expect(assistantMessage(page, "Child response completed independently.")).toBeVisible();
  await expect(userMessage(page, rootPrompt)).toHaveCount(0);
});
