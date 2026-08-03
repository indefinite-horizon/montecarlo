/** Guards Electron runtime, protocol, credential IPC, and packaging integration contracts. */

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const mainSource = readFileSync(path.join(__dirname, "main.cjs"), "utf8");
const preloadSource = readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
const builderConfig = readFileSync(path.join(desktopRoot, "electron-builder.yml"), "utf8");
const runtimeConfigSource = readFileSync(
  path.resolve(desktopRoot, "../runtime/src/config.ts"),
  "utf8",
);

describe("desktop integration contracts", () => {
  it("launches the runtime's real source and packaged entrypoints with its origin variable", () => {
    assert.match(mainSource, /runtime\/src\/index\.ts/);
    assert.match(mainSource, /"runtime", "runtime\.cjs"/);
    assert.match(mainSource, /MONTE_CARLO_RUNTIME_ALLOWED_ORIGINS/);
    assert.doesNotMatch(mainSource, /MONTE_CARLO_ALLOWED_ORIGINS/);
    assert.match(runtimeConfigSource, /port: 43_127/);
    assert.match(mainSource, /MONTE_CARLO_RUNTIME_PORT \?\? "0"/);
    assert.match(mainSource, /parseRuntimeReadyLine/);
    assert.match(mainSource, /requestSingleInstanceLock/);
    assert.doesNotMatch(mainSource, /baseUrl: `http:\/\/127\.0\.0\.1:\$\{runtimePort\}`/);
  });

  it("copies the bundled runtime output to the path used by packaged Electron", () => {
    assert.match(builderConfig, /from: \.\.\/runtime\/dist/);
    assert.match(builderConfig, /to: runtime/);
    assert.match(builderConfig, /"\*\*\/\*"/);
  });

  it("uses the custom protocol and exposes provider saves only as one-way IPC", () => {
    assert.match(mainSource, /protocol\.handle\("app"/);
    assert.match(mainSource, /window\.loadURL\(`\$\{desktopOrigin\}\//);
    assert.doesNotMatch(mainSource, /window\.loadFile/);
    assert.match(preloadSource, /ipcRenderer\.send\("provider-secret:save"/);
    assert.doesNotMatch(preloadSource, /ipcRenderer\.invoke\("provider-secret/);
  });
});
