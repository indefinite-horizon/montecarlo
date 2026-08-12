#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const version = readArgument("--version");
  const artifactsDirectory = path.resolve(readArgument("--directory") ?? "dist/desktop");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("--version must be a stable semantic version");
  }

  const metadataPath = path.join(artifactsDirectory, "latest-mac.yml");
  if (!existsSync(metadataPath)) throw new Error("latest-mac.yml was not generated");
  const metadata = readFileSync(metadataPath, "utf8");
  if (!metadata.includes(`version: ${version}`)) {
    throw new Error(`latest-mac.yml does not describe ${version}`);
  }
  if (!/sha512:\s*[A-Za-z0-9+/=]{40,}/.test(metadata)) {
    throw new Error("latest-mac.yml does not contain a SHA-512 artifact digest");
  }

  const files = readdirSync(artifactsDirectory);
  const expectedPrefix = `Monte-Carlo-${version}-universal`;
  const dmg = files.find((file) => file === `${expectedPrefix}.dmg`);
  const zip = files.find((file) => file === `${expectedPrefix}.zip`);
  if (!dmg || !zip) {
    throw new Error(`release must contain ${expectedPrefix}.dmg and ${expectedPrefix}.zip`);
  }
  if (!metadata.includes(zip)) {
    throw new Error("latest-mac.yml does not reference the universal zip artifact");
  }

  process.stdout.write(`Verified macOS updater artifacts for ${version}.\n`);
}

main();
