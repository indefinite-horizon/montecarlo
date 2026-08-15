/** Verifies deterministic source-controlled release version and note handling. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseReleaseNotes } from "../scripts/release_notes.mjs";
import {
  assertVersionNewer,
  bumpReleasePackages,
  compareStableVersions,
  highestStableTag,
  nextVersion,
  readReleasePackages,
  releaseLockPaths,
  releasePackagePaths,
} from "../scripts/release_version.mjs";

const temporaryRoots: string[] = [];

function temporaryRepository(version = "1.2.3") {
  const root = mkdtempSync(path.join(os.tmpdir(), "montecarlo-release-tooling-"));
  temporaryRoots.push(root);
  for (const relativePath of releasePackagePaths) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(
      absolutePath,
      `${JSON.stringify({ name: relativePath, version, private: true }, null, 2)}\n`,
    );
  }
  const lockPath = path.join(root, releaseLockPaths[0]);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        name: "@montecarlo/packaged-convex-project",
        version,
        lockfileVersion: 3,
        packages: {
          "": { name: "@montecarlo/packaged-convex-project", version },
          "packages/app-constants": { name: "@montecarlo/app-constants", version },
        },
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("release version tooling", () => {
  it.each([
    ["major", "2.0.0"],
    ["minor", "1.3.0"],
    ["patch", "1.2.4"],
  ])("computes a %s bump", (bump, expected) => {
    expect(nextVersion("1.2.3", bump)).toBe(expected);
  });

  it("bumps every release package together", () => {
    const root = temporaryRepository();
    expect(bumpReleasePackages("minor", root)).toEqual({
      previousVersion: "1.2.3",
      version: "1.3.0",
    });
    expect(readReleasePackages(root).version).toBe("1.3.0");
    for (const relativePath of releasePackagePaths) {
      expect(JSON.parse(readFileSync(path.join(root, relativePath), "utf8")).version).toBe("1.3.0");
    }
    const lock = JSON.parse(readFileSync(path.join(root, releaseLockPaths[0]), "utf8"));
    expect(lock.version).toBe("1.3.0");
    expect(lock.packages[""].version).toBe("1.3.0");
    expect(lock.packages["packages/app-constants"].version).toBe("1.3.0");
  });

  it("requires a release version newer than the published baseline", () => {
    expect(compareStableVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareStableVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareStableVersions("1.2.2", "1.2.3")).toBe(-1);
    expect(assertVersionNewer("1.3.0", "1.2.9")).toBe("1.3.0");
    expect(() => assertVersionNewer("1.2.3", "1.2.3")).toThrow(/must be greater/u);
  });

  it("selects the highest stable published tag and ignores other tags", () => {
    expect(highestStableTag(["v1.2.3", "nightly", "v2.0.0-beta.1", "1.10.0"])).toEqual({
      tag: "1.10.0",
      version: "1.10.0",
    });
    expect(highestStableTag(["nightly", "v1.0.0-beta.1"])).toBeUndefined();
  });

  it("rejects drift between package versions", () => {
    const root = temporaryRepository();
    const desktopPath = path.join(root, "apps/desktop/package.json");
    writeFileSync(desktopPath, '{"name":"desktop","version":"9.0.0"}\n');
    expect(() => readReleasePackages(root)).toThrow(/versions must match/u);
  });

  it("rejects drift in the pinned desktop Convex lockfile", () => {
    const root = temporaryRepository();
    const lockPath = path.join(root, releaseLockPaths[0]);
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.packages["packages/app-constants"].version = "9.0.0";
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    expect(() => readReleasePackages(root)).toThrow(/app-constants version must match/u);
  });
});

describe("release notes tooling", () => {
  it("extracts a hidden human title and a Conductor-style body", () => {
    expect(
      parseReleaseNotes(`<!-- release-title: Branching foundations -->

### Improvements

- You can now branch a conversation without losing context.
`),
    ).toEqual({
      body: "### Improvements\n\n- You can now branch a conversation without losing context.\n",
      title: "Branching foundations",
    });
  });

  it("rejects empty or repository-internal release notes", () => {
    expect(() => parseReleaseNotes("# v1.2.3\n\n- Internal refactor")).toThrow(/must start/u);
    expect(() =>
      parseReleaseNotes("<!-- release-title: Internal -->\n\n### Engineering\n\n- Updated CI."),
    ).toThrow(/Improvements, Fixes, or Misc/u);
  });

  it("rejects empty, repeated, or paragraph-only release-note sections", () => {
    expect(() => parseReleaseNotes("<!-- release-title: Empty -->\n\n### Improvements\n")).toThrow(
      /at least one bullet/u,
    );
    expect(() =>
      parseReleaseNotes(
        "<!-- release-title: Prose -->\n\n### Improvements\n\nA paragraph without a bullet.",
      ),
    ).toThrow(/one-line Markdown bullets/u);
    expect(() =>
      parseReleaseNotes(
        "<!-- release-title: Duplicate -->\n\n### Fixes\n\n- Fixed one issue.\n\n### Fixes\n\n- Fixed another issue.",
      ),
    ).toThrow(/must not be repeated/u);
  });
});
