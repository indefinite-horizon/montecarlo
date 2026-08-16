/** Tests the downloaded-only desktop update contract and one-click install handoff. */

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { describe, it } = require("node:test");
const {
  changelogUrl,
  createDesktopUpdater,
  normalizeDownloadedUpdate,
  normalizeReleaseName,
} = require("./desktop-updater.cjs");

class FakeUpdater extends EventEmitter {
  checks = 0;
  installs = 0;

  async checkForUpdates() {
    this.checks += 1;
  }

  quitAndInstall(isSilent, forceRunAfter) {
    assert.equal(isSilent, false);
    assert.equal(forceRunAfter, true);
    this.installs += 1;
  }
}

describe("desktop updater", () => {
  it("accepts only bounded release versions and produces a fixed-host changelog URL", () => {
    assert.deepEqual(
      normalizeDownloadedUpdate({
        version: "1.2.3",
        releaseName: "  Cloud   polish #2 ",
        releaseDate: "2026-08-11",
      }),
      {
        version: "1.2.3",
        releaseName: "Cloud polish #2",
        releaseDate: "2026-08-11",
      },
    );
    assert.equal(normalizeReleaseName("x".repeat(161)), undefined);
    assert.equal(normalizeDownloadedUpdate({ version: "https://attacker.invalid" }), undefined);
    assert.equal(
      changelogUrl("1.2.3"),
      "https://github.com/indefinite-horizon/montecarlo/releases/tag/v1.2.3",
    );
    assert.throws(() => changelogUrl("../latest"), /Invalid/);
  });

  it("notifies only after download and stops services before installing once", async () => {
    const autoUpdater = new FakeUpdater();
    const broadcasts = [];
    const lifecycle = [];
    const opened = [];
    const updater = createDesktopUpdater({
      autoUpdater,
      broadcast: (channel, value) => broadcasts.push([channel, value]),
      openExternal: async (url) => opened.push(url),
      prepareToInstall: async () => lifecycle.push("stopped"),
      reportDiagnostic: () => {},
    });
    updater.start();

    assert.equal(updater.claimDownloadedUpdate(), undefined);
    autoUpdater.emit("update-available", { version: "1.2.3" });
    assert.equal(broadcasts.length, 0);
    autoUpdater.emit("update-downloaded", { version: "1.2.3", releaseName: "Cloud polish #2" });
    assert.deepEqual(broadcasts, [
      [
        "desktop-update:downloaded",
        { version: "1.2.3", releaseName: "Cloud polish #2", releaseDate: undefined },
      ],
    ]);
    assert.deepEqual(updater.claimDownloadedUpdate(), {
      version: "1.2.3",
      releaseName: "Cloud polish #2",
      releaseDate: undefined,
    });
    assert.equal(updater.claimDownloadedUpdate(), undefined);

    await updater.openChangelog();
    assert.equal(opened[0], changelogUrl("1.2.3"));
    await Promise.all([updater.install(), updater.install()]);
    assert.deepEqual(lifecycle, ["stopped"]);
    assert.equal(autoUpdater.installs, 1);
    updater.dispose();
  });
});
