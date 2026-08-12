/** Guards Electron runtime, protocol, credential IPC, and packaging integration contracts. */

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

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
    assert.match(bunfig, /linker = "hoisted"/);
    assert.match(desktopPackage.scripts.build, /ensure:production-deps/);
    assert.match(desktopPackage.scripts["build:dir"], /ensure:production-deps/);
    assert.match(desktopPackage.scripts["build:smoke:mac"], /ensure:production-deps/);
    assert.match(desktopPackage.scripts["build:release:mac"], /ensure:production-deps/);
  });

  it("runs a persisted packaged-model turn before merge and release", () => {
    assert.match(ciWorkflow, /desktop-smoke-macos:/);
    assert.match(ciWorkflow, /actions\/setup-node@v4/);
    assert.match(ciWorkflow, /build:smoke:mac/);
    assert.match(ciWorkflow, /bash scripts\/smoke_packaged_desktop\.sh/);
    assert.match(releaseWorkflow, /bash scripts\/smoke_packaged_desktop\.sh/);
    assert.match(releaseWorkflow, /actions\/setup-node@v4/);
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
    assert.match(mainSource, /titleBarOverlay: \{ height: 64 \}/);
    assert.doesNotMatch(mainSource, /titleBarStyle: "hiddenInset"/);
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
  });
});
