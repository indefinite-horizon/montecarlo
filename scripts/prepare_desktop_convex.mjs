#!/usr/bin/env node

import { resolve } from "node:path";
import {
  DEFAULT_OUTPUT_DIRECTORY,
  prepareDesktopConvexBundle,
} from "./lib/desktop_convex_bundle.mjs";

const requestedTargets = [];
let outputDirectory = DEFAULT_OUTPUT_DIRECTORY;
let requestedPlatform;
let requestedArchitecture;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--target") {
    const target = process.argv[index + 1];
    if (!target) throw new Error("--target requires a value");
    requestedTargets.push(target);
    index += 1;
    continue;
  }
  if (argument.startsWith("--target=")) {
    requestedTargets.push(argument.slice("--target=".length));
    continue;
  }
  if (argument === "--platform") {
    requestedPlatform = process.argv[index + 1];
    if (!requestedPlatform) throw new Error("--platform requires a value");
    index += 1;
    continue;
  }
  if (argument.startsWith("--platform=")) {
    requestedPlatform = argument.slice("--platform=".length);
    continue;
  }
  if (argument === "--arch") {
    requestedArchitecture = process.argv[index + 1];
    if (!requestedArchitecture) throw new Error("--arch requires a value");
    index += 1;
    continue;
  }
  if (argument.startsWith("--arch=")) {
    requestedArchitecture = argument.slice("--arch=".length);
    continue;
  }
  if (argument === "--output") {
    const output = process.argv[index + 1];
    if (!output) throw new Error("--output requires a value");
    outputDirectory = resolve(output);
    index += 1;
    continue;
  }
  if (argument.startsWith("--output=")) {
    outputDirectory = resolve(argument.slice("--output=".length));
    continue;
  }
  throw new Error(`Unknown argument: ${argument}`);
}

if (requestedPlatform || requestedArchitecture) {
  if (requestedTargets.length > 0) {
    throw new Error("Use either --target or --platform/--arch, not both");
  }
  const platformAliases = { mac: "darwin", win32: "windows", win: "windows" };
  const platform = platformAliases[requestedPlatform] ?? requestedPlatform ?? process.platform;
  const architecture = requestedArchitecture ?? process.arch;
  if (architecture === "universal") {
    if (platform !== "darwin")
      throw new Error("The universal architecture is supported only on macOS");
    requestedTargets.push("mac-universal");
  } else {
    requestedTargets.push(`${platform}-${architecture}`);
  }
}

const result = await prepareDesktopConvexBundle({ requestedTargets, outputDirectory });
console.log(
  `Prepared Convex ${result.bundleManifest.backendRelease} for ${Object.keys(
    result.bundleManifest.binaries,
  ).join(", ")} at ${result.outputDirectory}`,
);
