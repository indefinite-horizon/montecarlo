/** Opt-in Electron journeys across renderer, IPC, and companion boundaries. */

import path from "node:path";
import { type ElectronApplication, _electron as electron, expect, test } from "@playwright/test";
import { assistantMessage, userMessage } from "../helpers/workspace";

const enabled = process.env.RUN_DESKTOP_E2E === "true";
const packagedExecutableValue = process.env.PACKAGED_DESKTOP_EXECUTABLE?.trim();
const packagedExecutable = packagedExecutableValue
  ? path.resolve(packagedExecutableValue)
  : undefined;
const packagedPlaywrightLoader = process.env.PACKAGED_DESKTOP_PLAYWRIGHT_LOADER?.trim();
const packagedUserDataDirectory = process.env.PACKAGED_DESKTOP_USER_DATA_DIR?.trim();
const packagedSmokeResponse = process.env.PACKAGED_DESKTOP_SMOKE_RESPONSE?.trim();
let app: ElectronApplication | undefined;

test.beforeEach(async () => {
  test.skip(!enabled, "Run with bun run test:e2e:desktop after the local web stack is ready.");
  if (packagedExecutable && !packagedPlaywrightLoader) {
    throw new Error("PACKAGED_DESKTOP_PLAYWRIGHT_LOADER is required for a packaged app.");
  }
  const packagedArguments = packagedPlaywrightLoader
    ? [
        "-r",
        packagedPlaywrightLoader,
        ...(packagedUserDataDirectory ? [`--user-data-dir=${packagedUserDataDirectory}`] : []),
      ]
    : [];
  app = await electron.launch({
    ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
    args: packagedExecutable ? packagedArguments : [path.resolve("apps/desktop/src/main.cjs")],
    env: {
      ...process.env,
      ELECTRON_START_URL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173/",
      MONTECARLO_OPEN_DEVTOOLS: "0",
    },
  });
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function firstWindow(options?: { timeout?: number }) {
  if (!app) throw new Error("Electron did not launch.");
  return app.firstWindow(options);
}

test("starts an authenticated companion and renders the workspace", async () => {
  const page = await firstWindow({ timeout: 180_000 });
  await expect(page.getByTestId("workspace-app")).toBeVisible();
  const runtime = await page.evaluate(() => window.monteCarloDesktop?.getRuntimeConfig());
  expect(runtime?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  expect(runtime?.token.length).toBeGreaterThan(32);
  if (packagedExecutable) {
    expect(page.url()).toMatch(/^app:\/\/montecarlo\//u);
    const endpoints = await page.evaluate(() => ({
      convexUrl: window.monteCarloDesktop?.convexUrl,
      convexSiteUrl: window.monteCarloDesktop?.convexSiteUrl,
    }));
    expect(endpoints.convexUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    expect(endpoints.convexSiteUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  }
});

test("packaged app completes and persists a model turn", async () => {
  test.skip(!packagedExecutable, "Requires PACKAGED_DESKTOP_EXECUTABLE.");
  test.skip(!packagedSmokeResponse, "Requires PACKAGED_DESKTOP_SMOKE_RESPONSE.");
  const response = packagedSmokeResponse;
  if (!response) throw new Error("PACKAGED_DESKTOP_SMOKE_RESPONSE is required.");
  const page = await firstWindow({ timeout: 180_000 });
  await expect(page.getByTestId("workspace-app")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("provider-trigger")).toHaveAccessibleName(/smoke-codex/u, {
    timeout: 60_000,
  });

  const prompt = "Verify the packaged desktop message path";
  await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(prompt);
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled({ timeout: 60_000 });
  await send.click();
  await expect(userMessage(page, prompt)).toHaveCount(1, { timeout: 60_000 });
  await expect(assistantMessage(page, response)).toHaveCount(1, {
    timeout: 60_000,
  });
  await expect(send).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await expect(userMessage(page, prompt)).toHaveCount(1, { timeout: 60_000 });
  await expect(assistantMessage(page, response)).toHaveCount(1, {
    timeout: 60_000,
  });
});

test("renderer cannot navigate to an untrusted origin", async () => {
  const page = await firstWindow();
  const trustedUrl = page.url();
  await page.evaluate(() => {
    window.location.href = "https://example.com/untrusted";
  });
  await page.waitForTimeout(250);
  expect(page.url()).toBe(trustedUrl);
});

test("desktop bridge permits key writes but exposes no key readback API", async () => {
  const page = await firstWindow();
  const bridgeShape = await page.evaluate(() => ({
    keys: Object.keys(window.monteCarloDesktop ?? {}).sort(),
    hasReadSecret: "readProviderSecret" in (window.monteCarloDesktop ?? {}),
  }));
  expect(bridgeShape.keys).toContain("saveProviderSecret");
  expect(bridgeShape.hasReadSecret).toBe(false);
});

test("desktop workspace root is confined below Electron userData", async () => {
  const page = await firstWindow();
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

test("packaged app owns its renderer and Convex loopback endpoints", async () => {
  test.skip(!packagedExecutable, "Requires PACKAGED_DESKTOP_EXECUTABLE.");
  const page = await firstWindow();
  expect(page.url()).toMatch(/^app:\/\/montecarlo\//u);
  const endpoints = await page.evaluate(() => ({
    convexUrl: window.monteCarloDesktop?.convexUrl,
    convexSiteUrl: window.monteCarloDesktop?.convexSiteUrl,
  }));
  expect(endpoints.convexUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  expect(endpoints.convexSiteUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
});
