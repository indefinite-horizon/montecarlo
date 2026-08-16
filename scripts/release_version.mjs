#!/usr/bin/env node

/** Keeps every source-controlled Monte Carlo package on one release version. */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const releasePackagePaths = Object.freeze([
  "package.json",
  "apps/desktop/package.json",
  "apps/desktop/convex-bundle/package.json",
  "apps/desktop/convex-bundle/packages/app-constants/package.json",
  "apps/runtime/package.json",
  "apps/web/package.json",
  "components/app-constants/package.json",
  "components/domain/package.json",
]);

export const releaseLockPaths = Object.freeze(["apps/desktop/convex-bundle/package-lock.json"]);

export function parseStableVersion(value, label = "version") {
  if (typeof value !== "string") throw new Error(`${label} is missing`);
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value);
  if (!match) throw new Error(`${label} must be a stable semantic version, received ${value}`);
  return Object.freeze({
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    text: value,
  });
}

export function nextVersion(currentValue, bump) {
  const current = parseStableVersion(currentValue, "current version");
  if (!new Set(["major", "minor", "patch"]).has(bump)) {
    throw new Error(`version bump must be major, minor, or patch; received ${bump}`);
  }
  if (bump === "major") return `${current.major + 1}.0.0`;
  if (bump === "minor") return `${current.major}.${current.minor + 1}.0`;
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

export function compareStableVersions(leftValue, rightValue) {
  const left = parseStableVersion(leftValue, "candidate version");
  const right = parseStableVersion(rightValue, "baseline version");
  for (const part of ["major", "minor", "patch"]) {
    if (left[part] > right[part]) return 1;
    if (left[part] < right[part]) return -1;
  }
  return 0;
}

export function assertVersionNewer(candidate, baseline) {
  if (compareStableVersions(candidate, baseline) <= 0) {
    throw new Error(`release version ${candidate} must be greater than ${baseline}`);
  }
  return candidate;
}

export function highestStableTag(tags) {
  let highest;
  for (const rawTag of tags) {
    if (typeof rawTag !== "string") continue;
    const tag = rawTag.trim();
    if (!tag) continue;
    const version = tag.startsWith("v") ? tag.slice(1) : tag;
    try {
      parseStableVersion(version, "release tag");
    } catch {
      continue;
    }
    if (!highest || compareStableVersions(version, highest.version) > 0) {
      highest = { tag, version };
    }
  }
  return highest === undefined ? undefined : Object.freeze(highest);
}

export function readReleasePackages(root = repositoryRoot) {
  const packages = releasePackagePaths.map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
    const version = parseStableVersion(manifest.version, `${relativePath} version`).text;
    return { absolutePath, manifest, relativePath, version };
  });
  const versions = new Set(packages.map(({ version }) => version));
  if (versions.size !== 1) {
    const details = packages
      .map(({ relativePath, version }) => `${relativePath}=${version}`)
      .join(", ");
    throw new Error(`release package versions must match: ${details}`);
  }
  const version = packages[0].version;
  const convexBundleLockPath = path.join(root, releaseLockPaths[0]);
  const convexBundleLock = JSON.parse(readFileSync(convexBundleLockPath, "utf8"));
  const lockVersions = [
    ["package-lock.json version", convexBundleLock.version],
    ["package-lock.json root version", convexBundleLock.packages?.[""]?.version],
    [
      "package-lock.json app-constants version",
      convexBundleLock.packages?.["packages/app-constants"]?.version,
    ],
  ];
  for (const [label, lockVersion] of lockVersions) {
    if (lockVersion !== version) {
      throw new Error(`${label} must match release version ${version}; received ${lockVersion}`);
    }
  }
  return Object.freeze({ convexBundleLock, convexBundleLockPath, packages, version });
}

export function bumpReleasePackages(bump, root = repositoryRoot) {
  const state = readReleasePackages(root);
  const version = nextVersion(state.version, bump);
  for (const releasePackage of state.packages) {
    releasePackage.manifest.version = version;
    writeFileSync(
      releasePackage.absolutePath,
      `${JSON.stringify(releasePackage.manifest, null, 2)}\n`,
      "utf8",
    );
  }
  state.convexBundleLock.version = version;
  state.convexBundleLock.packages[""].version = version;
  state.convexBundleLock.packages["packages/app-constants"].version = version;
  writeFileSync(
    state.convexBundleLockPath,
    `${JSON.stringify(state.convexBundleLock, null, 2)}\n`,
    "utf8",
  );
  return Object.freeze({ previousVersion: state.version, version });
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function positionalArguments() {
  const result = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--root") {
      index += 1;
      continue;
    }
    result.push(process.argv[index]);
  }
  return result;
}

function main() {
  const [command, first, second] = positionalArguments();
  const root = path.resolve(argumentValue("--root") ?? repositoryRoot);
  if (command === "current") {
    process.stdout.write(`${readReleasePackages(root).version}\n`);
    return;
  }
  if (command === "next") {
    process.stdout.write(`${nextVersion(readReleasePackages(root).version, first)}\n`);
    return;
  }
  if (command === "bump") {
    const result = bumpReleasePackages(first, root);
    process.stdout.write(`${result.version}\n`);
    return;
  }
  if (command === "assert-newer") {
    process.stdout.write(`${assertVersionNewer(first, second)}\n`);
    return;
  }
  if (command === "highest-tag") {
    const highest = highestStableTag(readFileSync(0, "utf8").split(/\r?\n/u));
    if (highest) process.stdout.write(`${highest.tag}\n`);
    return;
  }
  if (command === "paths") {
    process.stdout.write(`${[...releasePackagePaths, ...releaseLockPaths].join("\n")}\n`);
    return;
  }
  throw new Error(
    "usage: release_version.mjs <current|next|bump|assert-newer|highest-tag|paths> [major|minor|patch|candidate baseline]",
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
