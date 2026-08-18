#!/usr/bin/env node

/** Rebuilds updater metadata after Apple stapling changes the signed DMG bytes. */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function yamlScalar(source) {
  const value = source.trim();
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

export function replaceArtifactMetadata(metadata, artifactName, updateInfo) {
  if (!updateInfo || !Number.isSafeInteger(updateInfo.size) || updateInfo.size < 1) {
    throw new Error("updated artifact metadata requires a positive byte size");
  }
  if (!updateInfo.sha512 || Buffer.from(updateInfo.sha512, "base64").length !== 64) {
    throw new Error("updated artifact metadata requires a valid SHA-512 digest");
  }

  const lines = metadata.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const urlMatch = /^(\s*)-\s+url:\s*(.+?)\s*$/u.exec(lines[index]);
    if (!urlMatch || yamlScalar(urlMatch[2]) !== artifactName) continue;
    const itemIndent = urlMatch[1].length;
    let replacedDigest = false;
    let replacedSize = false;
    for (let itemIndex = index + 1; itemIndex < lines.length; itemIndex += 1) {
      const line = lines[itemIndex];
      const indentation = /^\s*/u.exec(line)?.[0].length ?? 0;
      if (line.trim() && indentation <= itemIndent) break;
      const digestMatch = /^(\s+)sha512:\s*\S+\s*$/u.exec(line);
      if (digestMatch) {
        lines[itemIndex] = `${digestMatch[1]}sha512: ${updateInfo.sha512}`;
        replacedDigest = true;
      }
      const sizeMatch = /^(\s+)size:\s*\d+\s*$/u.exec(line);
      if (sizeMatch) {
        lines[itemIndex] = `${sizeMatch[1]}size: ${updateInfo.size}`;
        replacedSize = true;
      }
    }
    if (!replacedDigest || !replacedSize) {
      throw new Error(`${artifactName} metadata is missing its SHA-512 digest or byte size`);
    }
    return lines.join("\n");
  }
  throw new Error(`latest-mac.yml does not reference ${artifactName}`);
}

function resolveBlockMapBuilder() {
  const repositoryRoot = process.cwd();
  const electronBuilderPackage = require.resolve("electron-builder/package.json", {
    paths: [path.join(repositoryRoot, "apps/desktop")],
  });
  const blockMapModule = require.resolve("app-builder-lib/out/targets/blockmap/blockmap", {
    paths: [path.dirname(electronBuilderPackage)],
  });
  const buildBlockMap = require(blockMapModule).buildBlockMap;
  if (typeof buildBlockMap !== "function") {
    throw new Error("electron-builder's block map generator is unavailable");
  }
  return buildBlockMap;
}

export async function refreshDesktopReleaseDmgMetadata({
  version,
  artifactsDirectory,
  buildBlockMap = resolveBlockMapBuilder(),
}) {
  if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error("version must be a stable semantic version");
  }
  const resolvedDirectory = path.resolve(artifactsDirectory);
  const artifactName = `Monte-Carlo-${version}-universal.dmg`;
  const artifactPath = path.join(resolvedDirectory, artifactName);
  const blockMapPath = `${artifactPath}.blockmap`;
  const metadataPath = path.join(resolvedDirectory, "latest-mac.yml");
  const updateInfo = await buildBlockMap(artifactPath, "gzip", blockMapPath);
  const metadata = readFileSync(metadataPath, "utf8");
  writeFileSync(metadataPath, replaceArtifactMetadata(metadata, artifactName, updateInfo));
  return Object.freeze({ artifactName, blockMapPath, metadataPath, ...updateInfo });
}

async function main() {
  const version = readArgument("--version");
  const artifactsDirectory = path.resolve(readArgument("--directory") ?? "dist/desktop");
  const result = await refreshDesktopReleaseDmgMetadata({ version, artifactsDirectory });
  process.stdout.write(
    `Refreshed updater metadata for ${result.artifactName} (${result.size} bytes).\n`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
