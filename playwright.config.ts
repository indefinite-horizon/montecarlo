/** Defines Playwright projects and local web servers for E2E tests. */

import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? "5173";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${webPort}`;
const authWebPort = process.env.PLAYWRIGHT_AUTH_WEB_PORT ?? "5174";
const authBaseURL = `http://localhost:${authWebPort}`;
const convexSiteURL = process.env.CONVEX_SITE_URL ?? "http://127.0.0.1:3211";
const convexSitePort = Number(new URL(convexSiteURL).port);
const convexReadyPort =
  process.env.PLAYWRIGHT_CONVEX_READY_PORT ??
  String(Number.isFinite(convexSitePort) && convexSitePort > 0 ? convexSitePort + 1000 : 4211);
const convexReadyURL = `http://127.0.0.1:${convexReadyPort}/ready`;
const convexReadyFile = ".context/playwright-convex-ready";
// envFile is only used in webServer commands below.
const envFile = process.env.PLAYWRIGHT_ENV_FILE ?? ".env.local";
// A single local Convex/auth stack backs every browser worker. Keep CI concurrency
// low enough that auth callbacks and workspace subscriptions remain deterministic.
const workerCount = Number(process.env.PLAYWRIGHT_WORKERS ?? (process.env.CI ? "2" : "4"));
const expectTimeout = Number(
  process.env.PLAYWRIGHT_EXPECT_TIMEOUT ?? (process.env.CI ? "15000" : "5000"),
);
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "true";
const externalSpecs = ["**/*.external.spec.ts"];
const nightlySpecs = ["**/*.nightly.external.spec.ts"];
const perfSpecs = ["**/*.perf.spec.ts"];
const authSpecs = ["**/auth/session.spec.ts"];
const localAnonymousSpecs = ["**/workspaces/local-anonymous.spec.ts"];
const desktopSpecs = ["**/desktop/*.spec.ts"];

export default defineConfig({
  testDir: "tests/e2e",
  timeout: process.env.CI ? 120_000 : 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: workerCount,
  expect: {
    timeout: expectTimeout,
  },
  outputDir: "test-results",
  reporter: process.env.CI ? [["line"]] : [["html", { outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-core",
      testIgnore: [
        ...externalSpecs,
        ...perfSpecs,
        ...authSpecs,
        ...localAnonymousSpecs,
        ...desktopSpecs,
      ],
      use: { ...devices["Desktop Chrome"], baseURL: authBaseURL },
    },
    {
      name: "chromium-local",
      testMatch: localAnonymousSpecs,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-auth",
      testMatch: authSpecs,
      use: { ...devices["Desktop Chrome"], baseURL: authBaseURL },
    },
    {
      name: "electron-desktop",
      testMatch: desktopSpecs,
    },
    {
      name: "chromium-external",
      testMatch: externalSpecs,
      testIgnore: nightlySpecs,
      use: { ...devices["Desktop Chrome"], baseURL: authBaseURL },
    },
    {
      name: "chromium-nightly",
      testMatch: nightlySpecs,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-perf",
      testMatch: perfSpecs,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : [
        {
          command: `PLAYWRIGHT_CONVEX_READY_PORT=${convexReadyPort} bash scripts/dev_convex_playwright.sh ${envFile}`,
          url: convexReadyURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: `bash -c 'while [ ! -f ${convexReadyFile} ]; do sleep 1; done; bun --env-file=${envFile} run --filter "./apps/web" dev -- --port ${webPort} --strictPort'`,
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: `bash -c 'while [ ! -f ${convexReadyFile} ]; do sleep 1; done; VITE_AUTH_REQUIRED=true bun --env-file=${envFile} run --filter "./apps/web" dev -- --port ${authWebPort} --strictPort'`,
          url: authBaseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
