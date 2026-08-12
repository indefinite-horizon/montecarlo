#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const policyUrl = new URL("../apps/desktop/release-compatibility.json", import.meta.url);
const builderConfigUrl = new URL("../apps/desktop/electron-builder.yml", import.meta.url);
const convexBackendManifestUrl = new URL(
  "../apps/desktop/convex-bundle/backend-manifest.json",
  import.meta.url,
);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseVersion(value, label) {
  if (typeof value !== "string") throw new Error(`${label} is missing`);
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(normalized);
  if (!match) throw new Error(`${label} is not a stable semantic version: ${value}`);
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} changed from ${JSON.stringify(expected)} to ${JSON.stringify(actual)}`,
    );
  }
}

function validatePolicy(policy) {
  if (policy.formatVersion !== 1) throw new Error("unsupported release compatibility format");
  if (!Number.isInteger(policy.dataLayoutVersion) || policy.dataLayoutVersion < 1) {
    throw new Error("dataLayoutVersion must be a positive integer");
  }
  if (
    !Number.isInteger(policy.minimumReadableDataLayoutVersion) ||
    policy.minimumReadableDataLayoutVersion < 1 ||
    policy.minimumReadableDataLayoutVersion > policy.dataLayoutVersion
  ) {
    throw new Error("minimumReadableDataLayoutVersion must be a readable data layout");
  }
  if (!Array.isArray(policy.dataMigrations)) throw new Error("dataMigrations must be an array");
  if (
    policy.dataLayoutVersion !== policy.minimumReadableDataLayoutVersion ||
    policy.dataMigrations.length !== 0
  ) {
    throw new Error(
      "desktop data migrations are not implemented; keep the data layout immutable until the migration executor and leap fixtures ship",
    );
  }
  const convexBackendManifest = JSON.parse(readFileSync(convexBackendManifestUrl, "utf8"));
  if (policy.convexBackendRelease !== convexBackendManifest.release) {
    throw new Error("convexBackendRelease must match the checksum-pinned desktop backend manifest");
  }
}

function validateBuilderConfig(policy) {
  const builderConfig = readFileSync(builderConfigUrl, "utf8");
  const requiredSnippets = [
    `appId: ${policy.appId}`,
    `productName: ${policy.productName}`,
    `executableName: ${policy.executableName}`,
    `electronUpdaterCompatibility: "${policy.updater.electronUpdaterCompatibility}"`,
    "generateUpdatesFilesForAllChannels: true",
    "  - src/desktop-updater.cjs",
    "  - src/local-convex.cjs",
    "    - Contents/Resources/convex/binaries/darwin-arm64/convex-local-backend",
    "    - Contents/Resources/convex/binaries/darwin-x64/convex-local-backend",
    `  provider: ${policy.updater.provider}`,
    `  owner: ${policy.updater.owner}`,
    `  repo: ${policy.updater.repo}`,
    `  channel: ${policy.updater.channel}`,
    "  releaseType: draft",
    "  notarize: true",
    "  x64ArchFiles: Contents/Resources/convex/",
    "Contents/Resources/convex/binaries/darwin-arm64/convex-local-backend",
    "Contents/Resources/convex/binaries/darwin-x64/convex-local-backend",
    "Contents/Resources/convex/project/node_modules/@esbuild/darwin-arm64/bin/esbuild",
    "Contents/Resources/convex/project/node_modules/@esbuild/darwin-x64/bin/esbuild",
    "    - dmg",
    "    - zip",
    "  sign: true",
  ];
  for (const snippet of requiredSnippets) {
    if (!builderConfig.includes(snippet)) {
      throw new Error(`electron-builder.yml is missing compatibility contract: ${snippet}`);
    }
  }
}

function validatePrevious(policy, previous, releaseVersion, signingTeamIdentifier) {
  if (previous.formatVersion !== 1) throw new Error("previous release manifest is unsupported");

  assertEqual(policy.appId, previous.compatibility.appId, "appId");
  assertEqual(policy.productName, previous.compatibility.productName, "productName");
  assertEqual(policy.executableName, previous.compatibility.executableName, "executableName");
  assertEqual(
    policy.convexBackendRelease,
    previous.compatibility.convexBackendRelease,
    "convexBackendRelease",
  );
  assertEqual(
    policy.minimumReadableDataLayoutVersion,
    previous.compatibility.minimumReadableDataLayoutVersion,
    "minimumReadableDataLayoutVersion",
  );
  assertEqual(
    policy.dataLayoutVersion,
    previous.compatibility.dataLayoutVersion,
    "dataLayoutVersion",
  );
  assertEqual(
    policy.updater.protocolVersion,
    previous.compatibility.updater.protocolVersion,
    "updater protocolVersion",
  );
  assertEqual(
    policy.updater.electronUpdaterCompatibility,
    previous.compatibility.updater.electronUpdaterCompatibility,
    "electronUpdaterCompatibility",
  );
  for (const field of ["channel", "provider", "owner", "repo"]) {
    assertEqual(policy.updater[field], previous.compatibility.updater[field], `updater ${field}`);
  }

  if (policy.dataLayoutVersion < previous.compatibility.dataLayoutVersion) {
    throw new Error("dataLayoutVersion cannot decrease");
  }
  const current = parseVersion(releaseVersion, "release version");
  const prior = parseVersion(previous.releaseVersion, "previous release version");
  if (compareVersions(current, prior) <= 0) {
    throw new Error(`${releaseVersion} must be newer than ${previous.releaseVersion}`);
  }
  parseVersion(previous.firstUpdaterCapableVersion, "first updater-capable version");
  if (
    signingTeamIdentifier &&
    previous.signingTeamIdentifier &&
    signingTeamIdentifier !== previous.signingTeamIdentifier
  ) {
    throw new Error(
      `signing TeamIdentifier changed from ${previous.signingTeamIdentifier} to ${signingTeamIdentifier}`,
    );
  }
}

function main() {
  const releaseVersion = readArgument("--version");
  const outputPath = readArgument("--output");
  const previousPath = readArgument("--previous");
  const signingTeamIdentifier = readArgument("--signing-team-id");
  parseVersion(releaseVersion, "release version");
  if (!outputPath) throw new Error("--output is required");

  const policy = JSON.parse(readFileSync(policyUrl, "utf8"));
  validatePolicy(policy);
  validateBuilderConfig(policy);

  const previous = previousPath ? JSON.parse(readFileSync(previousPath, "utf8")) : undefined;
  if (previous) validatePrevious(policy, previous, releaseVersion, signingTeamIdentifier);

  const manifest = {
    formatVersion: 1,
    releaseVersion,
    firstUpdaterCapableVersion: previous?.firstUpdaterCapableVersion ?? releaseVersion,
    ...(signingTeamIdentifier || previous?.signingTeamIdentifier
      ? { signingTeamIdentifier: signingTeamIdentifier ?? previous.signingTeamIdentifier }
      : {}),
    compatibility: policy,
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`Desktop release compatibility passed for ${releaseVersion}.\n`);
}

main();
