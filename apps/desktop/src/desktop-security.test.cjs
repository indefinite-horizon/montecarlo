/** Tests Electron renderer URL validation and packaged-asset path confinement. */

const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const {
  desktopOrigin,
  isAllowedRendererUrl,
  mimeTypeForPath,
  parseRuntimeReadyLine,
  readRuntimePort,
  resolveDevelopmentRendererUrl,
  resolveRendererAsset,
  runtimeDefaultPort,
} = require("./desktop-security.cjs");

describe("desktop security helpers", () => {
  let temporaryRoot;
  let rendererRoot;

  before(() => {
    temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "monte-carlo-desktop-"));
    rendererRoot = path.join(temporaryRoot, "renderer");
    mkdirSync(path.join(rendererRoot, "assets"), { recursive: true });
    writeFileSync(path.join(rendererRoot, "index.html"), "<html></html>");
    writeFileSync(path.join(rendererRoot, "assets", "app.js"), "export {};");
    writeFileSync(path.join(temporaryRoot, "secret.txt"), "outside renderer");
    symlinkSync(path.join(temporaryRoot, "secret.txt"), path.join(rendererRoot, "leak.txt"));
  });

  after(() => {
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("shares the runtime default and rejects invalid configured ports", () => {
    assert.equal(readRuntimePort(undefined), runtimeDefaultPort);
    assert.equal(readRuntimePort("43128"), 43_128);
    assert.equal(readRuntimePort("0"), 0);
    assert.throws(() => readRuntimePort("not-a-port"), /between 0 and 65535/);
  });

  it("accepts readiness only from a child-advertised loopback address", () => {
    assert.deepEqual(
      parseRuntimeReadyLine("Monte Carlo runtime listening on http://127.0.0.1:54321"),
      {
        baseUrl: "http://127.0.0.1:54321",
        port: 54_321,
      },
    );
    assert.equal(
      parseRuntimeReadyLine("Monte Carlo runtime listening on http://example.com:54321"),
      null,
    );
    assert.equal(
      parseRuntimeReadyLine("Monte Carlo runtime listening on http://127.0.0.1:0"),
      null,
    );
  });

  it("limits development renderer URLs and navigation to one loopback origin", () => {
    const rendererUrl = resolveDevelopmentRendererUrl("http://127.0.0.1:5173/chat");
    const origin = new URL(rendererUrl).origin;
    assert.equal(rendererUrl, "http://127.0.0.1:5173/chat");
    assert.equal(resolveDevelopmentRendererUrl("https://example.com"), "http://localhost:5173/");
    assert.equal(isAllowedRendererUrl(`${origin}/projects`, true, origin), true);
    assert.equal(isAllowedRendererUrl("http://127.0.0.1:5174/projects", true, origin), false);
  });

  it("allows only the canonical packaged renderer host", () => {
    assert.equal(isAllowedRendererUrl(`${desktopOrigin}/chat`, false, ""), true);
    assert.equal(isAllowedRendererUrl("app://other-host/chat", false, ""), false);
    assert.equal(isAllowedRendererUrl("file:///tmp/index.html", false, ""), false);
  });

  it("serves known assets with MIME types and falls back to the SPA document", () => {
    assert.deepEqual(resolveRendererAsset(rendererRoot, `${desktopOrigin}/assets/app.js`), {
      filePath: path.join(rendererRoot, "assets", "app.js"),
      mimeType: "text/javascript; charset=utf-8",
    });
    assert.deepEqual(resolveRendererAsset(rendererRoot, `${desktopOrigin}/projects/example`), {
      filePath: path.join(rendererRoot, "index.html"),
      mimeType: "text/html; charset=utf-8",
    });
    assert.equal(mimeTypeForPath("font.woff2"), "font/woff2");
  });

  it("rejects traversal, symlink escapes, unknown assets, and the wrong host", () => {
    assert.equal(resolveRendererAsset(rendererRoot, `${desktopOrigin}/%2e%2e%2fsecret.txt`), null);
    assert.equal(resolveRendererAsset(rendererRoot, `${desktopOrigin}/leak.txt`), null);
    assert.equal(resolveRendererAsset(rendererRoot, `${desktopOrigin}/assets/missing.js`), null);
    assert.equal(resolveRendererAsset(rendererRoot, "app://other-host/index.html"), null);
  });
});
