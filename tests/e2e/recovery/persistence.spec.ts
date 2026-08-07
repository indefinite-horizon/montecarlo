/** Durable reload and recoverable runtime/object-store failures. */

import { expect, test } from "@playwright/test";
import { conversationRequests, installRuntimeMock, type RuntimeMock } from "../helpers/runtime";
import {
  createProject,
  createPromptBranch,
  createWorkspace,
  openFreshUser,
  sendMessage,
  userMessage,
} from "../helpers/workspace";

let runtime: RuntimeMock;

test.beforeEach(async ({ context, page }) => {
  runtime = await installRuntimeMock(context);
  await openFreshUser(page, "recovery");
  await createWorkspace(page, `Recovery workspace ${Date.now()}`);
});

test("workspace, project, chat, nested branches, and messages survive reload", async ({ page }) => {
  await createProject(page, "Persistent project");
  await sendMessage(page, "Persistent root turn", "Stub response: Persistent root turn");
  await createPromptBranch(page, "Persistent child");
  await createPromptBranch(page, "Persistent grandchild");
  await sendMessage(page, "Persistent leaf turn", "Stub response: Persistent leaf turn");

  await page.reload();
  await expect(page.getByText("Persistent project", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Persistent child", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Persistent grandchild", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Persistent grandchild", exact: true }).click();
  await expect(userMessage(page, "Persistent leaf turn")).toBeVisible();
});

test("blob upload failure does not publish a phantom available message", async ({ page }) => {
  await page.route("**/v1/blobs/**", (route) => {
    if (route.request().method() === "PUT") return route.abort("connectionrefused");
    return route.fallback();
  });
  const prompt = "This upload must fail";
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("workspace could not save", { exact: false })).toBeVisible();
  await expect(userMessage(page, prompt)).toHaveCount(0);

  await page.reload();
  await expect(userMessage(page, prompt)).toHaveCount(0);
});

test("reload during a delayed generation returns to a usable non-streaming state", async ({
  page,
}) => {
  const prompt = "[e2e:slow] Interrupted generation";
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect.poll(() => conversationRequests(runtime).length).toBe(1);
  await page.reload();
  await expect(userMessage(page, prompt)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await sendMessage(page, "Recovered after reload", "Stub response: Recovered after reload");
});

test("Convex mutation failure never renders a phantom project, chat, or branch", async () => {
  test.fixme(
    true,
    "Requires a scoped Convex transport fault injector; WebSocket mutation frames cannot be safely intercepted with page.route.",
  );
});
