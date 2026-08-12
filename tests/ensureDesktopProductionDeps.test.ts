/** Links desktop production deps from Bun's store when workspace links are missing. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureDesktopProductionDependencies,
  findPackageInBunStore,
} from "../scripts/ensure_desktop_production_deps.mjs";

const fixtures: string[] = [];

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "montecarlo-desktop-deps-"));
  fixtures.push(root);
  const desktopRoot = join(root, "apps/desktop");
  mkdirSync(desktopRoot, { recursive: true });
  writeFileSync(
    join(desktopRoot, "package.json"),
    JSON.stringify({
      name: "@montecarlo/desktop",
      dependencies: { "electron-updater": "6.8.9" },
      devDependencies: { electron: "^43.0.0" },
    }),
  );
  return { root, desktopRoot };
}

describe("ensureDesktopProductionDependencies", () => {
  it("finds isolated Bun store entries including scoped names", () => {
    const { root } = makeFixture();
    const store = join(root, "node_modules/.bun");
    const updater = join(store, "electron-updater@6.8.9/node_modules/electron-updater");
    const scoped = join(store, "@scope+pkg@1.0.0/node_modules/@scope/pkg");
    mkdirSync(updater, { recursive: true });
    mkdirSync(scoped, { recursive: true });
    writeFileSync(join(updater, "package.json"), JSON.stringify({ name: "electron-updater" }));
    writeFileSync(join(scoped, "package.json"), JSON.stringify({ name: "@scope/pkg" }));

    expect(findPackageInBunStore("electron-updater", store)).toBe(updater);
    expect(findPackageInBunStore("@scope/pkg", store)).toBe(scoped);
  });

  it("symlinks missing workspace production and Electron packaging dependencies", () => {
    const { root, desktopRoot } = makeFixture();
    const updater = join(
      root,
      "node_modules/.bun/electron-updater@6.8.9/node_modules/electron-updater",
    );
    const electron = join(root, "node_modules/.bun/electron@43.1.1/node_modules/electron");
    mkdirSync(updater, { recursive: true });
    mkdirSync(electron, { recursive: true });
    writeFileSync(join(updater, "package.json"), JSON.stringify({ name: "electron-updater" }));
    writeFileSync(join(electron, "package.json"), JSON.stringify({ name: "electron" }));

    const linked = ensureDesktopProductionDependencies({
      desktopRoot,
      repositoryRoot: root,
    });

    expect(linked).toEqual([
      join(desktopRoot, "node_modules/electron-updater"),
      join(desktopRoot, "node_modules/electron"),
    ]);
    expect(
      JSON.parse(
        readFileSync(join(desktopRoot, "node_modules/electron-updater/package.json"), "utf8"),
      ),
    ).toEqual({
      name: "electron-updater",
    });
  });

  it("replaces a broken workspace link and is a no-op when the package already resolves", () => {
    const { root, desktopRoot } = makeFixture();
    const updater = join(
      root,
      "node_modules/.bun/electron-updater@6.8.9/node_modules/electron-updater",
    );
    const electron = join(root, "node_modules/.bun/electron@43.1.1/node_modules/electron");
    mkdirSync(updater, { recursive: true });
    mkdirSync(electron, { recursive: true });
    writeFileSync(join(updater, "package.json"), JSON.stringify({ name: "electron-updater" }));
    writeFileSync(join(electron, "package.json"), JSON.stringify({ name: "electron" }));
    mkdirSync(join(desktopRoot, "node_modules"), { recursive: true });
    symlinkSync(
      join(root, "missing-electron-updater"),
      join(desktopRoot, "node_modules/electron-updater"),
    );

    expect(ensureDesktopProductionDependencies({ desktopRoot, repositoryRoot: root })).toEqual([
      join(desktopRoot, "node_modules/electron-updater"),
      join(desktopRoot, "node_modules/electron"),
    ]);
    expect(ensureDesktopProductionDependencies({ desktopRoot, repositoryRoot: root })).toEqual([]);
  });

  it("links hoisted root packages into the desktop package node_modules", () => {
    const { root, desktopRoot } = makeFixture();
    const updater = join(root, "node_modules/electron-updater");
    const electron = join(root, "node_modules/electron");
    mkdirSync(updater, { recursive: true });
    mkdirSync(electron, { recursive: true });
    writeFileSync(join(updater, "package.json"), JSON.stringify({ name: "electron-updater" }));
    writeFileSync(join(electron, "package.json"), JSON.stringify({ name: "electron" }));

    expect(ensureDesktopProductionDependencies({ desktopRoot, repositoryRoot: root })).toEqual([
      join(desktopRoot, "node_modules/electron-updater"),
      join(desktopRoot, "node_modules/electron"),
    ]);
  });

  it("fails when the declared production dependency is not installed anywhere", () => {
    const { root, desktopRoot } = makeFixture();
    expect(() =>
      ensureDesktopProductionDependencies({ desktopRoot, repositoryRoot: root }),
    ).toThrow(/electron-updater not found/);
  });
});
