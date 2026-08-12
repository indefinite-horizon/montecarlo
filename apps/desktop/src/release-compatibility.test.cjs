/** Verifies immutable desktop release identity and direct-update compatibility gates. */

const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, describe, it } = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../../..");
const checkerPath = path.join(repositoryRoot, "scripts/check_desktop_release_compatibility.mjs");
const releaseWorkflow = readFileSync(
  path.join(repositoryRoot, ".github/workflows/desktop-release.yml"),
  "utf8",
);
const builderConfig = readFileSync(
  path.join(repositoryRoot, "apps/desktop/electron-builder.yml"),
  "utf8",
);
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "montecarlo-release-compatibility-"));

function runChecker(arguments_) {
  return spawnSync(process.execPath, [checkerPath, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

describe("desktop release compatibility", () => {
  it("releases only successful main-branch source pushes or main dispatches", () => {
    assert.match(releaseWorkflow, /github\.ref == 'refs\/heads\/main'/);
    assert.match(releaseWorkflow, /workflow_run\.event == 'push'/);
    assert.match(releaseWorkflow, /workflow_run\.head_branch == 'main'/);
    assert.match(releaseWorkflow, /workflow_run\.head_repository\.full_name == github\.repository/);
  });

  it("pins the updater identity and public update feed", () => {
    const policy = JSON.parse(
      readFileSync(path.join(repositoryRoot, "apps/desktop/release-compatibility.json"), "utf8"),
    );
    assert.equal(policy.appId, "chat.montecarlo.desktop");
    assert.equal(policy.executableName, "montecarlo");
    assert.equal(policy.convexBackendRelease, "precompiled-2026-08-10-c0cb7ae");
    assert.equal(policy.dataLayoutVersion, 1);
    assert.equal(policy.minimumReadableDataLayoutVersion, 1);
    assert.deepEqual(policy.dataMigrations, []);
    assert.deepEqual(policy.updater, {
      protocolVersion: 1,
      electronUpdaterCompatibility: ">=2.16",
      channel: "latest",
      provider: "github",
      owner: "indefinite-horizon",
      repo: "montecarlo-releases",
    });
    assert.match(
      builderConfig,
      /x64ArchFiles: Contents\/Resources\/convex\/\{binaries\/darwin-arm64,binaries\/darwin-x64,project\/node_modules\/@esbuild\/darwin-arm64,project\/node_modules\/@esbuild\/darwin-x64\}\/\*\*/,
    );
  });

  it("keeps direct updates on the original Apple signing team", () => {
    const firstManifest = path.join(temporaryRoot, "first.json");
    const first = runChecker([
      "--version",
      "1.0.0",
      "--signing-team-id",
      "FIRSTTEAM1",
      "--output",
      firstManifest,
    ]);
    assert.equal(first.status, 0, first.stderr);

    const compatible = runChecker([
      "--version",
      "1.0.1",
      "--previous",
      firstManifest,
      "--signing-team-id",
      "FIRSTTEAM1",
      "--output",
      path.join(temporaryRoot, "compatible.json"),
    ]);
    assert.equal(compatible.status, 0, compatible.stderr);

    const incompatible = runChecker([
      "--version",
      "1.0.1",
      "--previous",
      firstManifest,
      "--signing-team-id",
      "SECONDTEAM",
      "--output",
      path.join(temporaryRoot, "incompatible.json"),
    ]);
    assert.notEqual(incompatible.status, 0);
    assert.match(incompatible.stderr, /signing TeamIdentifier changed/);
  });
});
