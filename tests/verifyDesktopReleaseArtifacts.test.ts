/** Verifies release metadata hashes the exact ZIP that will be served to the updater. */

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDesktopReleaseArtifacts } from "../scripts/verify_desktop_release_artifacts.mjs";

const temporaryDirectories: string[] = [];

function releaseFixture({ digest = true } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "montecarlo-release-artifacts-"));
  temporaryDirectories.push(directory);
  const version = "1.2.3";
  const zip = `Monte-Carlo-${version}-universal.zip`;
  const dmg = `Monte-Carlo-${version}-universal.dmg`;
  const zipContents = Buffer.from("signed update fixture");
  const dmgContents = Buffer.from("installer");
  writeFileSync(path.join(directory, zip), zipContents);
  writeFileSync(path.join(directory, dmg), dmgContents);
  const zipSha512 = createHash("sha512").update(zipContents).digest("base64");
  const dmgSha512 = createHash("sha512").update(dmgContents).digest("base64");
  const recordedDigest = digest
    ? zipSha512
    : createHash("sha512").update("different build").digest("base64");
  const blockMap = gzipSync(JSON.stringify({ files: [{ name: "file" }], version: "2" }));
  writeFileSync(path.join(directory, `${zip}.blockmap`), blockMap);
  writeFileSync(path.join(directory, `${dmg}.blockmap`), blockMap);
  writeFileSync(
    path.join(directory, "latest-mac.yml"),
    `version: ${version}\nfiles:\n  - url: ${zip}\n    sha512: ${recordedDigest}\n    size: ${zipContents.length}\n  - url: ${dmg}\n    sha512: ${dmgSha512}\n    size: ${dmgContents.length}\npath: ${zip}\nsha512: ${recordedDigest}\n`,
  );
  return { directory, version };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("desktop release artifacts", () => {
  it("accepts metadata whose ZIP size and SHA-512 match", async () => {
    const { directory, version } = releaseFixture();
    await expect(
      verifyDesktopReleaseArtifacts({ version, artifactsDirectory: directory }),
    ).resolves.toEqual({
      dmg: `Monte-Carlo-${version}-universal.dmg`,
      dmgBlockMap: `Monte-Carlo-${version}-universal.dmg.blockmap`,
      metadata: "latest-mac.yml",
      zip: `Monte-Carlo-${version}-universal.zip`,
      zipBlockMap: `Monte-Carlo-${version}-universal.zip.blockmap`,
    });
  });

  it("rejects metadata copied from a different build", async () => {
    const { directory, version } = releaseFixture({ digest: false });
    await expect(
      verifyDesktopReleaseArtifacts({ version, artifactsDirectory: directory }),
    ).rejects.toThrow(/digest does not match/u);
  });
});
