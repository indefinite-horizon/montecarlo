/** Verifies the pinned, checksum-validated Convex desktop resource manifest. */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  CONVEX_BUNDLE_TEMPLATE,
  normalizeTargets,
  validateBackendManifest,
  validateDesktopDataPolicy,
} from "../scripts/lib/desktop_convex_bundle.mjs";

describe("desktop Convex bundle", () => {
  it("expands the universal Mac target and de-duplicates explicit targets", () => {
    expect(normalizeTargets(["mac-universal", "darwin-arm64"])).toEqual([
      "darwin-arm64",
      "darwin-x64",
    ]);
  });

  it("maps the host target without guessing an architecture", () => {
    expect(normalizeTargets(["host"], { platform: "linux", arch: "x64" })).toEqual(["linux-x64"]);
  });

  it("pins every supported binary and the upstream license by digest", async () => {
    const manifest = JSON.parse(
      await readFile(`${CONVEX_BUNDLE_TEMPLATE}/backend-manifest.json`, "utf8"),
    );
    const targets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-x64"];

    expect(() => validateBackendManifest(manifest, targets)).not.toThrow();
    expect(manifest.release).toBe("precompiled-2026-08-10-c0cb7ae");
    const assets = Object.values(manifest.targets as Record<string, { sha256: string }>);
    expect(new Set(assets.map((asset) => asset.sha256)).size).toBe(5);
  });

  it("rejects an unsupported build target before downloading anything", async () => {
    const manifest = JSON.parse(
      await readFile(`${CONVEX_BUNDLE_TEMPLATE}/backend-manifest.json`, "utf8"),
    );
    expect(() => validateBackendManifest(manifest, ["freebsd-x64"])).toThrow(
      "No pinned Convex backend binary",
    );
  });

  it("refuses manifest-only data migrations until an executor exists", () => {
    const current = {
      formatVersion: 1,
      dataLayoutVersion: 1,
      minimumReadableDataLayoutVersion: 1,
      dataMigrations: [],
    };

    expect(validateDesktopDataPolicy(current)).toBe(current);
    expect(() =>
      validateDesktopDataPolicy({
        ...current,
        dataLayoutVersion: 2,
        dataMigrations: ["1-to-2"],
      }),
    ).toThrow("not implemented");
  });
});
