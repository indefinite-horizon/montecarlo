/** Equivalent durable conversation journeys across local and cloud workspace storage. */

import { expect, test } from "@playwright/test";
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

test.beforeEach(async ({ context }) => {
  runtime = await installRuntimeMock(context);
});

for (const storage of storageCases) {
  test(`${storage.label} workspace persists the durable conversation journey`, async ({ page }) => {
    await openFreshUser(page, `persistence-${storage.mode}`);
    const suffix = Date.now();
    const workspaceName = `${storage.label} workspace ${suffix}`;
    const projectName = `${storage.label} project ${suffix}`;
    const reply = `${storage.label} persistence is ready`;
    const prompt = `${storage.label} ${"persistence-chunk ".repeat(100)}[reply:${reply}]`;

    await createWorkspace(page, workspaceName, storage.mode);
    await expect(page.getByText(storage.status, { exact: true })).toBeVisible();
    await createProject(page, projectName);
    await createChat(page, projectName);
    await sendMessage(page, prompt, reply);

    expect(new Set(runtime.blobBackends.values())).toEqual(new Set([storage.backend]));
    expect(runtime.blobs.size).toBeGreaterThanOrEqual(2);

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
    await expect(userMessage(page, prompt)).toBeVisible();
    await expect(assistantMessage(page, reply)).toBeVisible();
    await expect.poll(() => runtime.blobReads.length).toBeGreaterThanOrEqual(2);
    expect(new Set(runtime.blobReads.map((read) => read.backend))).toEqual(
      new Set([storage.backend]),
    );
  });
}
