/** Verifies packaged and unpackaged desktop build identity selection. */

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  desktopBuildIdentityConfig,
  resolveDesktopBuildIdentity,
} = require("./desktop-build-identity.cjs");

describe("desktop build identity", () => {
  it("uses the development identity for unpackaged Electron", () => {
    assert.deepEqual(
      resolveDesktopBuildIdentity({
        isPackaged: false,
        channel: desktopBuildIdentityConfig.channels.production,
      }),
      { appName: "Monte Carlo (Dev)", isDevelopmentBuild: true },
    );
  });

  it("uses the isolated development identity embedded by local packaging", () => {
    assert.deepEqual(
      resolveDesktopBuildIdentity({
        isPackaged: true,
        channel: desktopBuildIdentityConfig.channels.development,
      }),
      { appName: "Monte Carlo (Dev)", isDevelopmentBuild: true },
    );
  });

  it("uses the production identity embedded by release packaging", () => {
    assert.deepEqual(
      resolveDesktopBuildIdentity({
        isPackaged: true,
        channel: desktopBuildIdentityConfig.channels.production,
      }),
      { appName: "Monte Carlo", isDevelopmentBuild: false },
    );
  });

  it("fails closed when packaged metadata has no recognized channel", () => {
    assert.throws(
      () => resolveDesktopBuildIdentity({ isPackaged: true, channel: undefined }),
      /build channel is missing or invalid/,
    );
    assert.throws(
      () => resolveDesktopBuildIdentity({ isPackaged: true, channel: "preview" }),
      /build channel is missing or invalid/,
    );
  });
});
