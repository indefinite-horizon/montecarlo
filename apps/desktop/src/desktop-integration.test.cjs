/** Guards Electron runtime, protocol, credential IPC, and packaging integration contracts. */

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { pathToFileURL } = require("node:url");

const desktopRoot = path.resolve(__dirname, "..");
const mainSource = readFileSync(path.join(__dirname, "main.cjs"), "utf8");
const preloadSource = readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
const builderConfig = readFileSync(path.join(desktopRoot, "electron-builder.yml"), "utf8");
const ciWorkflow = readFileSync(
  path.resolve(desktopRoot, "../../.github/workflows/ci.yml"),
  "utf8",
);
const releaseWorkflow = readFileSync(
  path.resolve(desktopRoot, "../../.github/workflows/desktop-release.yml"),
  "utf8",
);
const smokeScript = readFileSync(
  path.resolve(desktopRoot, "../../scripts/smoke_packaged_desktop.sh"),
  "utf8",
);
const runtimeConfigSource = readFileSync(
  path.resolve(desktopRoot, "../runtime/src/config.ts"),
  "utf8",
);
const desktopConvexBundlePath = path.resolve(
  desktopRoot,
  "../../scripts/lib/desktop_convex_bundle.mjs",
);
const devLauncher = readFileSync(path.resolve(desktopRoot, "../../scripts/dev_desktop.sh"), "utf8");
const appCss = readFileSync(path.resolve(desktopRoot, "../web/src/styles/app.css"), "utf8");
const devToolsMenu = readFileSync(
  path.resolve(desktopRoot, "../web/src/components/DevToolsMenu.tsx"),
  "utf8",
);
const workspaceSidebar = readFileSync(
  path.resolve(desktopRoot, "../web/src/components/WorkspaceSidebar.tsx"),
  "utf8",
);
const workspaceHeader = readFileSync(
  path.resolve(desktopRoot, "../web/src/components/WorkspaceHeader.tsx"),
  "utf8",
);
const branchMap = readFileSync(
  path.resolve(desktopRoot, "../web/src/components/BranchMap.tsx"),
  "utf8",
);

describe("desktop integration contracts", () => {
  it("launches the runtime's real source and packaged entrypoints with its origin variable", () => {
    assert.match(mainSource, /runtime\/src\/index\.ts/);
    assert.match(mainSource, /"runtime", "runtime\.cjs"/);
    assert.match(mainSource, /MONTECARLO_RUNTIME_ALLOWED_ORIGINS/);
    assert.doesNotMatch(mainSource, /MONTECARLO_ALLOWED_ORIGINS/);
    assert.match(runtimeConfigSource, /port: 43_127/);
    assert.match(mainSource, /MONTECARLO_RUNTIME_PORT \?\? "0"/);
    assert.match(mainSource, /parseRuntimeReadyLine/);
    assert.match(mainSource, /requestSingleInstanceLock/);
    assert.doesNotMatch(mainSource, /baseUrl: `http:\/\/127\.0\.0\.1:\$\{runtimePort\}`/);
  });

  it("copies the bundled runtime output to the path used by packaged Electron", () => {
    assert.match(builderConfig, /from: \.\.\/runtime\/dist/);
    assert.match(builderConfig, /to: runtime/);
    assert.match(builderConfig, /"\*\*\/\*"/);
  });

  it("packages and supervises the offline Convex bundle", () => {
    assert.match(builderConfig, /from: \.\.\/\.\.\/\.desktop-resources\/convex/);
    assert.match(builderConfig, /to: convex/);
    assert.match(builderConfig, /src\/local-convex\.cjs/);
    assert.match(mainSource, /createLocalConvexSupervisor/);
    assert.match(mainSource, /localConvexSupervisor\.start\(\)/);
    assert.match(mainSource, /montecarlo-convex-url/);
    assert.match(preloadSource, /readLoopbackArgument\("montecarlo-convex-url"\)/);
  });

  it("records the exact staged Convex CLI version in bundle metadata", async () => {
    const { pinnedDependencyVersion } = await import(pathToFileURL(desktopConvexBundlePath).href);
    const bundlePackage = JSON.parse(
      readFileSync(path.join(desktopRoot, "convex-bundle/package.json"), "utf8"),
    );
    assert.equal(pinnedDependencyVersion(bundlePackage, "convex"), "1.43.0");
    assert.throws(
      () => pinnedDependencyVersion({ dependencies: { convex: "^1.43.0" } }, "convex"),
      /must be pinned to an exact version/,
    );
  });

  it("exposes only downloaded-update controls and stops services before install", () => {
    assert.match(builderConfig, /electronUpdaterCompatibility: ">=2\.16"/);
    assert.match(builderConfig, /generateUpdatesFilesForAllChannels: true/);
    assert.match(builderConfig, /- dmg/);
    assert.match(builderConfig, /- zip/);
    assert.match(mainSource, /desktop-update:get-downloaded/);
    assert.match(mainSource, /prepareForUpdateInstall/);
    assert.match(preloadSource, /desktop-update:downloaded/);
    assert.doesNotMatch(preloadSource, /update-available/);
  });

  it("materializes production dependencies before electron-builder runs", () => {
    const desktopPackage = JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
    const bunfig = readFileSync(path.resolve(desktopRoot, "../../bunfig.toml"), "utf8");
    assert.equal(desktopPackage.dependencies["electron-updater"], "6.8.9");
    // Hoisted installs mix @types/react copies and break Vercel `tsc --noEmit`.
    assert.doesNotMatch(bunfig, /linker\s*=\s*"hoisted"/);
    assert.match(builderConfig, /electronVersion: "43\.1\.1"/);
    assert.match(desktopPackage.scripts.build, /ensure:production-deps/);
    assert.match(desktopPackage.scripts["build:dir"], /ensure:production-deps/);
    assert.match(desktopPackage.scripts["build:smoke:mac"], /ensure:production-deps/);
    assert.match(desktopPackage.scripts["build:release:mac"], /ensure:production-deps/);
  });

  it("runs a persisted packaged-model turn before merge and release", () => {
    assert.match(ciWorkflow, /desktop-smoke-macos:/);
    assert.match(ciWorkflow, /if: github\.event_name == 'push'/);
    assert.match(ciWorkflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4/);
    assert.match(ciWorkflow, /build:smoke:mac/);
    assert.match(ciWorkflow, /bash scripts\/smoke_packaged_desktop\.sh/);
    assert.match(releaseWorkflow, /bash scripts\/smoke_packaged_desktop\.sh/);
    assert.match(
      releaseWorkflow,
      /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4/,
    );
    assert.match(smokeScript, /CODEX_PATH="\$fake_codex"/);
    assert.match(smokeScript, /PACKAGED_DESKTOP_EXECUTABLE="\$executable"/);
    assert.match(smokeScript, /playwright-core\/lib\/server\/electron\/loader\.js/);
    assert.doesNotMatch(mainSource, /__playwright_run/);
    assert.match(smokeScript, /packaged app completes and persists a model turn/);
    assert.doesNotMatch(ciWorkflow, /CODEX_HOME|auth\.json/);
    assert.doesNotMatch(releaseWorkflow, /CODEX_HOME|auth\.json/);
  });

  it("uses the custom protocol and exposes provider saves only as one-way IPC", () => {
    assert.match(mainSource, /protocol\.handle\("app"/);
    assert.match(mainSource, /window\.loadURL\(`\$\{desktopOrigin\}\//);
    assert.match(mainSource, /will-prevent-unload/);
    assert.doesNotMatch(mainSource, /window\.loadFile/);
    assert.match(preloadSource, /ipcRenderer\.send\("provider-secret:save"/);
    assert.doesNotMatch(preloadSource, /ipcRenderer\.invoke\("provider-secret/);
  });

  it("keeps the custom titlebar scoped to macOS and exposes its native safe area", () => {
    assert.match(mainSource, /process\.platform === "darwin"/);
    assert.match(mainSource, /titleBarStyle: "hidden"/);
    assert.match(mainSource, /titleBarOverlay: \{ height: 48 \}/);
    assert.match(mainSource, /trafficLightPosition: \{ x: 16, y: 16 \}/);
    assert.doesNotMatch(mainSource, /titleBarStyle: "hiddenInset"/);
    assert.match(workspaceSidebar, /electron-titlebar flex h-12/);
    assert.match(workspaceHeader, /electron-titlebar z-30 flex h-12/);
    assert.match(branchMap, /electron-titlebar flex h-12/);
  });

  it("opens the development renderer using the local stack port precedence", () => {
    assert.match(devLauncher, /SITE_PORT:-\$\{LOCAL_FRONTEND_PORT:-\$\{CONDUCTOR_PORT:-5173\}\}/);
    assert.match(devLauncher, /ELECTRON_START_URL:-http:\/\/localhost:/);
    assert.match(devLauncher, /bunx wait-on "\$ELECTRON_START_URL"/);
  });

  it("keeps the draggable development menu interactive in Electron titlebars", () => {
    assert.match(appCss, /\.electron-no-drag/);
    assert.match(appCss, /\.electron-titlebar-leading-snug/);
    assert.match(workspaceSidebar, /className="electron-titlebar-leading-snug/);
    assert.match(workspaceHeader, /: "electron-titlebar-leading-snug"/);
    assert.match(devToolsMenu, /className="electron-no-drag pointer-events-none fixed/);
    assert.match(devToolsMenu, /className="electron-no-drag pointer-events-auto flex touch-none/);
    assert.match(devToolsMenu, /"electron-no-drag pointer-events-auto ml-1 rounded/);
    assert.match(devToolsMenu, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  });

  it("forwards the platform new-chat shortcut without opening a browser window", () => {
    assert.match(mainSource, /process\.platform === "darwin"/);
    assert.match(mainSource, /input\.meta && !input\.control/);
    assert.match(mainSource, /input\.control && !input\.meta/);
    assert.match(mainSource, /!input\.isAutoRepeat/);
    assert.match(mainSource, /input\.key\.toLowerCase\(\) === "n"/);
    assert.match(mainSource, /window\.webContents\.send\("new-chat"\)/);
    assert.match(preloadSource, /ipcRenderer\.on\("new-chat"/);
    assert.match(preloadSource, /ipcRenderer\.removeListener\("new-chat"/);
    assert.match(preloadSource, /if \(newChatHandler\) ipcRenderer\.removeListener/);
    assert.doesNotMatch(preloadSource, /newChatHandlers = new WeakMap/);
  });
});
