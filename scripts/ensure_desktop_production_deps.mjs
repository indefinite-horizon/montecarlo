#!/usr/bin/env node
/** Materializes desktop production deps where electron-builder can resolve them. */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = join(moduleDirectory, "..");
export const DESKTOP_ROOT = join(REPOSITORY_ROOT, "apps/desktop");

function packageJsonPath(directory) {
  return join(directory, "package.json");
}

export function readDesktopProductionDependencies(desktopRoot = DESKTOP_ROOT) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath(desktopRoot), "utf8"));
  const production = Object.keys(packageJson.dependencies ?? {});
  // electron-builder reads apps/desktop/node_modules/electron to pin the
  // downloaded binary when package.json declares a version range.
  const packaging = packageJson.devDependencies?.electron ? ["electron"] : [];
  return [...new Set([...production, ...packaging])];
}

export function resolveInstalledPackage(packageName, fromDirectory) {
  try {
    return dirname(
      createRequire(packageJsonPath(fromDirectory)).resolve(`${packageName}/package.json`),
    );
  } catch {
    return undefined;
  }
}

export function findPackageInBunStore(packageName, storeDirectory) {
  if (!existsSync(storeDirectory)) return undefined;
  const storeName = packageName.replaceAll("/", "+");
  const prefix = `${storeName}@`;
  for (const entry of readdirSync(storeDirectory)) {
    if (entry !== storeName && !entry.startsWith(prefix)) continue;
    const candidate = join(storeDirectory, entry, "node_modules", packageName);
    if (existsSync(packageJsonPath(candidate))) return candidate;
  }
  return undefined;
}

function isUsablePackage(directory) {
  return existsSync(packageJsonPath(directory));
}

export function linkPackageIntoNodeModules(packageName, destinationRoot, locatedDirectory) {
  const destination = join(destinationRoot, "node_modules", packageName);
  if (isUsablePackage(destination)) return destination;
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  if (existing) rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  const linkTarget = relative(dirname(destination), locatedDirectory) || ".";
  symlinkSync(linkTarget, destination, process.platform === "win32" ? "junction" : "dir");
  return destination;
}

export function ensureDesktopProductionDependencies({
  desktopRoot = DESKTOP_ROOT,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  const bunStore = join(repositoryRoot, "node_modules/.bun");
  const linked = [];
  for (const packageName of readDesktopProductionDependencies(desktopRoot)) {
    const destination = join(desktopRoot, "node_modules", packageName);
    if (isUsablePackage(destination)) continue;
    const located =
      resolveInstalledPackage(packageName, desktopRoot) ??
      resolveInstalledPackage(packageName, repositoryRoot) ??
      findPackageInBunStore(packageName, bunStore);
    if (!located) {
      throw new Error(
        `Production dependency ${packageName} not found for package @montecarlo/desktop`,
      );
    }
    linked.push(linkPackageIntoNodeModules(packageName, desktopRoot, located));
  }
  return linked;
}

const isCli =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) ensureDesktopProductionDependencies();
