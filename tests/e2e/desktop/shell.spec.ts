/** Opt-in Electron journeys across renderer, IPC, and companion boundaries. */

import path from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  test,
} from "@playwright/test";

const enabled = process.env.RUN_DESKTOP_E2E === "true";
let app: ElectronApplication;

test.beforeEach(async () => {
  test.skip(!enabled, "Run with bun run test:e2e:desktop after the local web stack is ready.");
  app = await electron.launch({
    args: [path.resolve("apps/desktop/src/main.cjs")],
    env: {
      ...process.env,
      ELECTRON_START_URL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173/",
      MONTECARLO_OPEN_DEVTOOLS: "0",
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

function appRegion(element: Element): string {
  const style = getComputedStyle(element);
  return style.getPropertyValue("app-region") || style.getPropertyValue("-webkit-app-region");
}

async function expectTitlebarControlsInside(
  titlebar: Locator,
  safeArea: { x: number; width: number },
) {
  const controls = await titlebar
    .locator("button, a, input, select, textarea, [role='button'], [role='menuitem']")
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const { x, width } = element.getBoundingClientRect();
        if (width === 0) return [];
        return [
          { label: element.getAttribute("aria-label") ?? element.textContent?.trim(), x, width },
        ];
      }),
    );
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control.x, `${control.label} starts before the native safe area`).toBeGreaterThanOrEqual(
      safeArea.x,
    );
    expect(
      control.x + control.width,
      `${control.label} ends after the native safe area`,
    ).toBeLessThanOrEqual(safeArea.x + safeArea.width);
  }
}

test("macOS titlebar stays inside the native safe area and keeps controls interactive", async () => {
  test.skip(process.platform !== "darwin", "Native traffic-light geometry is macOS-only.");
  const page = await app.firstWindow();
  const movable = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMovable() ?? false,
  );
  expect(movable).toBe(true);
  const safeArea = await page.evaluate(() => {
    const overlay = (
      navigator as Navigator & {
        windowControlsOverlay?: {
          visible: boolean;
          getTitlebarAreaRect(): DOMRect;
        };
      }
    ).windowControlsOverlay;
    if (!overlay?.visible) return null;
    const { x, y, width, height } = overlay.getTitlebarAreaRect();
    return { x, y, width, height };
  });
  expect(safeArea).not.toBeNull();
  if (!safeArea) return;

  const sidebarTitlebar = page.getByTestId("sidebar-titlebar");
  const sidebarDragHandle = page.getByTestId("sidebar-titlebar-drag-handle");
  const collapseSidebar = page.getByRole("button", { name: "Collapse sidebar" });
  expect(await sidebarTitlebar.evaluate(appRegion)).toBe("drag");
  expect(await sidebarDragHandle.evaluate(appRegion)).toBe("drag");
  expect(await collapseSidebar.evaluate(appRegion)).toBe("no-drag");
  const sidebarBox = await sidebarTitlebar.boundingBox();
  expect(sidebarBox?.height).toBe(safeArea.height);
  await expectTitlebarControlsInside(sidebarTitlebar, safeArea);
  const workspaceTitlebar = page.getByTestId("workspace-titlebar");
  await expectTitlebarControlsInside(workspaceTitlebar, safeArea);
  const branchMapTitlebar = page.getByTestId("branch-map-titlebar");
  expect(await branchMapTitlebar.evaluate(appRegion)).toBe("drag");
  const closeBranchMap = page.getByRole("button", { name: "Close branch map" });
  expect(await closeBranchMap.evaluate(appRegion)).toBe("no-drag");
  const branchMapBox = await branchMapTitlebar.boundingBox();
  expect(branchMapBox?.height).toBe(safeArea.height);
  await expectTitlebarControlsInside(branchMapTitlebar, safeArea);

  await collapseSidebar.click();
  const openSidebar = page.getByRole("button", { name: "Open sidebar" });
  expect(await workspaceTitlebar.evaluate(appRegion)).toBe("drag");
  expect(await openSidebar.evaluate(appRegion)).toBe("no-drag");
  const workspaceBox = await workspaceTitlebar.boundingBox();
  expect(workspaceBox?.height).toBe(safeArea.height);
  await expectTitlebarControlsInside(workspaceTitlebar, safeArea);

  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
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
