#!/usr/bin/env node

/** Verifies the installer and OTA metadata came from the same macOS build. */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

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

export function parseArtifactMetadata(metadata, artifactName) {
  const lines = metadata.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const urlMatch = /^(\s*)-\s+url:\s*(.+?)\s*$/u.exec(lines[index]);
    if (!urlMatch || yamlScalar(urlMatch[2]) !== artifactName) continue;
    const itemIndent = urlMatch[1].length;
    let sha512;
    let size;
    for (const line of lines.slice(index + 1)) {
      const indentation = /^\s*/u.exec(line)?.[0].length ?? 0;
      if (line.trim() && indentation <= itemIndent) break;
      const digestMatch = /^\s+sha512:\s*(\S+)\s*$/u.exec(line);
      if (digestMatch) sha512 = yamlScalar(digestMatch[1]);
      const sizeMatch = /^\s+size:\s*(\d+)\s*$/u.exec(line);
      if (sizeMatch) size = Number.parseInt(sizeMatch[1], 10);
    }
    if (!sha512 || Buffer.from(sha512, "base64").length !== 64) {
      throw new Error(`${artifactName} metadata is missing a valid SHA-512 digest`);
    }
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new Error(`${artifactName} metadata is missing a positive byte size`);
    }
    return Object.freeze({ sha512, size });
  }
  throw new Error(`latest-mac.yml does not reference ${artifactName}`);
}

async function sha512File(filePath) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("base64");
}

function verifyBlockMap(blockMapPath, artifactName) {
  let blockMap;
  try {
    blockMap = JSON.parse(gunzipSync(readFileSync(blockMapPath)).toString("utf8"));
  } catch {
    throw new Error(`${artifactName}.blockmap is not valid gzip-compressed JSON`);
  }
  if (!blockMap || !Array.isArray(blockMap.files) || blockMap.files.length === 0) {
    throw new Error(`${artifactName}.blockmap does not contain any files`);
  }
}

export async function verifyDesktopReleaseArtifacts({ version, artifactsDirectory }) {
  if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error("version must be a stable semantic version");
  }
  const resolvedDirectory = path.resolve(artifactsDirectory);
  const metadataPath = path.join(resolvedDirectory, "latest-mac.yml");
  if (!existsSync(metadataPath)) throw new Error("latest-mac.yml was not generated");
  const metadata = readFileSync(metadataPath, "utf8");
  if (!new RegExp(`^version:\\s*${version.replaceAll(".", "\\.")}\\s*$`, "mu").test(metadata)) {
    throw new Error(`latest-mac.yml does not describe ${version}`);
  }

  const files = readdirSync(resolvedDirectory);
  const expectedPrefix = `Monte-Carlo-${version}-universal`;
  const dmg = files.find((file) => file === `${expectedPrefix}.dmg`);
  const zip = files.find((file) => file === `${expectedPrefix}.zip`);
  if (!dmg || !zip) {
    throw new Error(`release must contain ${expectedPrefix}.dmg and ${expectedPrefix}.zip`);
  }

  for (const artifact of [dmg, zip]) {
    const artifactPath = path.join(resolvedDirectory, artifact);
    const artifactMetadata = parseArtifactMetadata(metadata, artifact);
    const actualSize = statSync(artifactPath).size;
    if (artifactMetadata.size !== actualSize) {
      throw new Error(
        `latest-mac.yml records ${artifactMetadata.size} bytes for ${artifact}; found ${actualSize}`,
      );
    }
    const actualDigest = await sha512File(artifactPath);
    if (artifactMetadata.sha512 !== actualDigest) {
      throw new Error(`latest-mac.yml SHA-512 digest does not match ${artifact}`);
    }
    const blockMapPath = `${artifactPath}.blockmap`;
    if (!existsSync(blockMapPath)) throw new Error(`${artifact}.blockmap was not generated`);
    verifyBlockMap(blockMapPath, artifact);
  }

  return Object.freeze({
    dmg,
    dmgBlockMap: `${dmg}.blockmap`,
    metadata: "latest-mac.yml",
    zip,
    zipBlockMap: `${zip}.blockmap`,
  });
}

async function main() {
  const version = readArgument("--version");
  const artifactsDirectory = path.resolve(readArgument("--directory") ?? "dist/desktop");
  await verifyDesktopReleaseArtifacts({ version, artifactsDirectory });
  process.stdout.write(`Verified macOS updater artifacts for ${version}.\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
