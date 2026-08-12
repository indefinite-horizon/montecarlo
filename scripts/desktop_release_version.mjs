#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";

const desktopPackageUrl = new URL("../apps/desktop/package.json", import.meta.url);

function parseVersion(value, label) {
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(normalized);
  if (!match) {
    throw new Error(
      `${label} must be a stable semantic version, received ${JSON.stringify(value)}`,
    );
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    text: normalized,
  };
}

function compareVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const runNumberText = readArgument("--run-number") ?? process.env.GITHUB_RUN_NUMBER;
  const latestTag = readArgument("--latest-tag");
  if (!runNumberText || !/^\d+$/.test(runNumberText)) {
    throw new Error("--run-number must be a positive GitHub Actions run number");
  }

  const runNumber = Number.parseInt(runNumberText, 10);
  if (!Number.isSafeInteger(runNumber) || runNumber < 1) {
    throw new Error("--run-number must be a positive safe integer");
  }

  const desktopPackage = JSON.parse(readFileSync(desktopPackageUrl, "utf8"));
  const base = parseVersion(desktopPackage.version, "apps/desktop/package.json version");
  const candidate = parseVersion(
    `${base.major}.${base.minor}.${base.patch + runNumber}`,
    "generated version",
  );

  if (latestTag) {
    const latest = parseVersion(latestTag, "latest release tag");
    if (compareVersions(candidate, latest) <= 0) {
      throw new Error(
        `generated version ${candidate.text} must be newer than ${latest.text}; bump the desktop package major or minor version`,
      );
    }
  }

  process.stdout.write(`${candidate.text}\n`);
}

main();
