/** Cross-account tenant isolation through the public browser boundary. */

import { expect, test } from "@playwright/test";
import { signIn } from "../helpers/auth";
import { uniqueEmail } from "../helpers/ids";
import { installRuntimeMock } from "../helpers/runtime";
import { createProject, createWorkspace } from "../helpers/workspace";

test("a second user cannot discover another user's workspace content", async ({ browser }) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await installRuntimeMock(contextA);
  await signIn(pageA, uniqueEmail("tenant-a"));
  await createWorkspace(pageA, "Tenant A private workspace");
  await createProject(pageA, "Tenant A secret project");

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await installRuntimeMock(contextB);
  await signIn(pageB, uniqueEmail("tenant-b"));
  await expect(pageB.getByText("Tenant A private workspace", { exact: true })).toHaveCount(0);
  await expect(pageB.getByText("Tenant A secret project", { exact: true })).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test("inactive membership loses access immediately", async () => {
  test.fixme(
    true,
    "Requires a test-only admin fixture that can revoke a membership without exposing it publicly.",
  );
});
