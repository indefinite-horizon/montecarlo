/** Tests the packaged Convex boundary, credential store, and compatibility refusal gates. */

const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const {
  assertCompatibleState,
  buildBackendArguments,
  loadOrCreateCredentials,
  platformKey,
  recoverInterruptedUpgrade,
  validateBundleManifest,
} = require("./local-convex.cjs");

function fakeSafeStorage() {
  return {
    decryptString: (value) =>
      Buffer.from(value)
        .toString("utf8")
        .replace(/^protected:/u, ""),
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    getSelectedStorageBackend: () => "kwallet",
    isEncryptionAvailable: () => true,
  };
}

function bundleManifest() {
  return {
    schemaVersion: 1,
    backendRelease: "precompiled-test",
    dataFormatVersion: 1,
    minimumReadableDataFormatVersion: 1,
    binaries: { [platformKey()]: "bin/backend" },
    cliEntrypoint: "project/node_modules/convex/dist/cli.bundle.cjs",
    projectDirectory: "project",
  };
}

describe("local Convex desktop boundary", () => {
  let temporaryDirectory;

  before(() => {
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "montecarlo-local-convex-"));
  });

  after(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("persists generated root credentials only through encrypted safeStorage", () => {
    const filePath = path.join(temporaryDirectory, "credentials.json");
    const first = loadOrCreateCredentials({ filePath, safeStorage: fakeSafeStorage() });
    const encoded = readFileSync(filePath, "utf8");

    assert.equal(encoded.includes(first.instanceSecret), false);
    assert.equal(encoded.includes(first.attestationPrivateKey), false);
    assert.equal(first.instanceSecret.length, 64);
    assert.deepEqual(loadOrCreateCredentials({ filePath, safeStorage: fakeSafeStorage() }), first);
  });

  it("forces loopback binding, explicit storage, and production privacy flags", () => {
    const credentials = {
      instanceSecret: "a".repeat(64),
    };
    const args = buildBackendArguments({
      backendUrl: "http://127.0.0.1:41000",
      credentials,
      databasePath: "/private/data/convex.sqlite3",
      siteUrl: "http://127.0.0.1:41001",
      storagePath: "/private/data/storage",
    });

    assert.deepEqual(args.slice(0, 7), [
      "/private/data/convex.sqlite3",
      "--interface",
      "127.0.0.1",
      "--port",
      "41000",
      "--site-proxy-port",
      "41001",
    ]);
    assert.ok(args.includes("--disable-beacon"));
    assert.ok(args.includes("--redact-logs-to-client"));
    assert.equal(args[args.indexOf("--local-storage") + 1], "/private/data/storage");
  });

  it("rejects an unbundled architecture and unplanned data/backend migrations", () => {
    const manifest = bundleManifest();
    assert.equal(validateBundleManifest(manifest).backendRelease, "precompiled-test");
    assert.throws(() => validateBundleManifest({ ...manifest, binaries: {} }), /does not support/);
    assert.doesNotThrow(() =>
      assertCompatibleState(
        {
          schemaVersion: 1,
          appVersion: "0.1.0",
          backendRelease: "precompiled-test",
          dataFormatVersion: 1,
        },
        manifest,
      ),
    );
    assert.throws(
      () =>
        assertCompatibleState(
          {
            schemaVersion: 1,
            appVersion: "0.1.0",
            backendRelease: "precompiled-older",
            dataFormatVersion: 1,
          },
          manifest,
        ),
      /without a tested data migration/,
    );
    assert.throws(
      () =>
        assertCompatibleState(
          {
            schemaVersion: 1,
            appVersion: "0.1.0",
            backendRelease: "precompiled-test",
            dataFormatVersion: 2,
          },
          manifest,
        ),
      /cannot safely open local data format/,
    );
  });

  it("restores the old state manifest after an interrupted deployment", async () => {
    const root = path.join(temporaryDirectory, "interrupted");
    const dataDirectory = path.join(root, "data");
    const storagePath = path.join(dataDirectory, "storage");
    const rollbackPath = path.join(root, "rollback");
    const manifestPath = path.join(root, "state.json");
    const pendingPath = path.join(root, "pending-upgrade.json");
    const oldState = {
      schemaVersion: 1,
      appVersion: "0.1.0",
      backendRelease: "precompiled-test",
      dataFormatVersion: 1,
    };
    const newState = { ...oldState, appVersion: "0.1.1" };
    mkdirSync(path.join(rollbackPath, "data", "storage"), { recursive: true });
    mkdirSync(storagePath, { recursive: true });
    writeFileSync(path.join(dataDirectory, "convex.sqlite3"), "partially-upgraded");
    writeFileSync(path.join(rollbackPath, "data", "convex.sqlite3"), "old-database");
    writeFileSync(path.join(rollbackPath, "state.json"), JSON.stringify(oldState));
    writeFileSync(manifestPath, JSON.stringify(newState));
    writeFileSync(pendingPath, JSON.stringify({ toAppVersion: "0.1.1" }));

    const recoveredState = await recoverInterruptedUpgrade({
      dataDirectory,
      manifestPath,
      pendingPath,
      rollbackPath,
      state: newState,
      storagePath,
    });

    assert.deepEqual(recoveredState, oldState);
    assert.equal(readFileSync(path.join(dataDirectory, "convex.sqlite3"), "utf8"), "old-database");
  });
});
