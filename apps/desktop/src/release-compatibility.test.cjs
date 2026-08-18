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
  it("releases only explicit main-branch dispatches", () => {
    assert.match(releaseWorkflow, /\non:\n {2}workflow_dispatch:\n/);
    assert.match(
      releaseWorkflow,
      /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
    );
    assert.match(releaseWorkflow, /source_sha:/);
    assert.match(releaseWorkflow, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
    assert.doesNotMatch(releaseWorkflow, /inputs\.release_id/);
    assert.match(releaseWorkflow, /created-draft\.json/);
    assert.match(releaseWorkflow, /tag_name: \$tag/);
    assert.doesNotMatch(releaseWorkflow, /target_commitish/);
    const tagCreationIndex = releaseWorkflow.search(/"repos\/\$\{UPDATE_REPOSITORY\}\/git\/refs"/);
    const draftCreationIndex = releaseWorkflow.search(/"repos\/\$\{UPDATE_REPOSITORY\}\/releases"/);
    assert.notEqual(tagCreationIndex, -1);
    assert.notEqual(draftCreationIndex, -1);
    assert.ok(
      tagCreationIndex < draftCreationIndex,
      "the exact tag must exist before GitHub creates the release draft",
    );
    assert.doesNotMatch(releaseWorkflow, /git\/refs\/tags\/\$\{tag\}[\s\S]*force: true/);
    assert.match(releaseWorkflow, /merge-base --is-ancestor/);
    assert.match(releaseWorkflow, /rev-list --first-parent origin\/main/);
    assert.match(releaseWorkflow, /expected-source-files\.txt/);
    assert.match(
      releaseWorkflow,
      /if ! git diff --quiet "\$parent_sha" "\$SOURCE_SHA" -- bun\.lock/,
    );
    assert.match(releaseWorkflow, /UPDATE_REPOSITORY: \$\{\{ github\.repository \}\}/);
    assert.match(releaseWorkflow, /permissions:\n {6}contents: write/);
    assert.match(releaseWorkflow, /bun scripts\/release_version\.mjs current/);
    assert.match(releaseWorkflow, /release_version\.mjs assert-newer/);
    assert.match(releaseWorkflow, /bun scripts\/release_notes\.mjs validate/);
    assert.doesNotMatch(releaseWorkflow, /previous_arguments=\(\)/);
    assert.match(releaseWorkflow, /compatibility_arguments=\(--version "\$RELEASE_VERSION"\)/);
    assert.match(releaseWorkflow, /select\(\.draft == true and \.tag_name/);
    assert.match(releaseWorkflow, /git\/matching-refs\/tags\/\$\{tag\}/);
    assert.match(releaseWorkflow, /commits\/\$\{RELEASE_TAG\}/);
    assert.match(releaseWorkflow, /make_latest: "true"/);
    assert.match(releaseWorkflow, /universal\.dmg\.blockmap/);
    assert.match(releaseWorkflow, /universal\.zip\.blockmap/);
    const stapleIndex = releaseWorkflow.search(/xcrun stapler staple "\$dmg_path"/);
    const refreshMetadataIndex = releaseWorkflow.search(
      /git show "\$\{WORKFLOW_SHA\}:scripts\/refresh_desktop_release_dmg_metadata\.mjs"/,
    );
    const verifyArtifactsIndex = releaseWorkflow.search(
      /bun scripts\/verify_desktop_release_artifacts\.mjs/,
    );
    const loadSmokeHarnessIndex = releaseWorkflow.search(
      /git show "\$\{WORKFLOW_SHA\}:tests\/e2e\/desktop\/shell\.spec\.ts"/,
    );
    const smokePackageIndex = releaseWorkflow.search(
      /bash scripts\/smoke_packaged_desktop\.sh "\$app_path"/,
    );
    assert.notEqual(stapleIndex, -1);
    assert.notEqual(refreshMetadataIndex, -1);
    assert.notEqual(verifyArtifactsIndex, -1);
    assert.notEqual(loadSmokeHarnessIndex, -1);
    assert.notEqual(smokePackageIndex, -1);
    assert.ok(stapleIndex < refreshMetadataIndex);
    assert.ok(refreshMetadataIndex < verifyArtifactsIndex);
    assert.ok(verifyArtifactsIndex < loadSmokeHarnessIndex);
    assert.ok(loadSmokeHarnessIndex < smokePackageIndex);
    assert.match(releaseWorkflow, /WORKFLOW_SHA: \$\{\{ github\.sha \}\}/);
    assert.match(releaseWorkflow, /expected-assets\.tsv/);
    assert.match(releaseWorkflow, /pre-publish-assets\.tsv/);
    assert.match(
      releaseWorkflow,
      /uploads\.github\.com\/repos\/\$\{UPDATE_REPOSITORY\}\/releases\/\$\{RELEASE_ID\}\/assets/,
    );
    assert.doesNotMatch(releaseWorkflow, /gh release upload/);
    assert.doesNotMatch(releaseWorkflow, /DESKTOP_RELEASE_TOKEN|GITHUB_RUN_NUMBER/);
    assert.doesNotMatch(releaseWorkflow, /\bworkflow_run:/);
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
      repo: "montecarlo",
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
