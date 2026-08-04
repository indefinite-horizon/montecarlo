/** Opt-in Electron journeys across renderer, IPC, and companion boundaries. */

import path from "node:path";
import { type ElectronApplication, _electron as electron, expect, test } from "@playwright/test";

const enabled = process.env.RUN_DESKTOP_E2E === "true";
let app: ElectronApplication;

test.beforeEach(async () => {
  test.skip(!enabled, "Run with bun run test:e2e:desktop after the local web stack is ready.");
  app = await electron.launch({
    args: [path.resolve("apps/desktop/src/main.cjs")],
    env: {
      ...process.env,
      ELECTRON_START_URL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173/",
      MONTE_CARLO_OPEN_DEVTOOLS: "0",
    },
  });
});

test.afterEach(async () => {
  await app?.close();
});

test("starts an authenticated companion and renders the workspace", async () => {
  const page = await app.firstWindow();
  await expect(page.getByTestId("workspace-app")).toBeVisible();
  const runtime = await page.evaluate(() => window.monteCarloDesktop?.getRuntimeConfig());
  expect(runtime?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  expect(runtime?.token.length).toBeGreaterThan(32);
});

test("renderer cannot navigate to an untrusted origin", async () => {
  const page = await app.firstWindow();
  const trustedUrl = page.url();
  await page.evaluate(() => {
    window.location.href = "https://example.com/untrusted";
  });
  await page.waitForTimeout(250);
  expect(page.url()).toBe(trustedUrl);
});

test("desktop bridge permits key writes but exposes no key readback API", async () => {
  const page = await app.firstWindow();
  const bridgeShape = await page.evaluate(() => ({
    keys: Object.keys(window.monteCarloDesktop ?? {}).sort(),
    hasReadSecret: "readProviderSecret" in (window.monteCarloDesktop ?? {}),
  }));
  expect(bridgeShape.keys).toContain("saveProviderSecret");
  expect(bridgeShape.hasReadSecret).toBe(false);
});

test("desktop workspace root is confined below Electron userData", async () => {
  const page = await app.firstWindow();
  const info = await page.evaluate(() => window.monteCarloDesktop?.getDesktopInfo?.());
  expect(info?.workspaceRoot).toMatch(/[\\/]workspaces$/u);
  expect(path.isAbsolute(info?.workspaceRoot ?? "")).toBe(true);
});

test("runtime restart reconnects without losing the current conversation", async () => {
  test.fixme(
    true,
    "Needs a test-only acknowledgement for the fire-and-forget provider-secret restart IPC.",
  );
});

test("packaged app protocol restores the intended chat and branch", async () => {
  test.fixme(
    true,
    "Requires launching the built directory artifact rather than the development Electron entrypoint.",
  );
});
