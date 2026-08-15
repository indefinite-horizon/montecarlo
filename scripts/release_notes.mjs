#!/usr/bin/env node

/** Validates and extracts source-controlled GitHub release notes. */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseStableVersion } from "./release_version.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const titlePattern = /^<!-- release-title: ([^<>\r\n]{1,80}) -->$/u;

export function releaseNotesPath(version, root = repositoryRoot) {
  parseStableVersion(version, "release version");
  return path.join(root, "docs/releases", `v${version}.md`);
}

export function parseReleaseNotes(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  const [titleLine, ...remainingLines] = normalized.split("\n");
  const title = titlePattern.exec(titleLine)?.[1]?.trim();
  if (!title || title.includes("--")) {
    throw new Error("release notes must start with <!-- release-title: A concise human title -->");
  }
  const body = remainingLines.join("\n").trim();
  if (!body) throw new Error("release notes body must not be empty");
  if (!/^### (Improvements|Fixes|Misc)$/mu.test(body)) {
    throw new Error("release notes must contain at least one Improvements, Fixes, or Misc section");
  }
  const unsupportedHeadings = [...body.matchAll(/^#{1,6} (.+)$/gmu)]
    .map((match) => match[0])
    .filter((heading) => !/^### (Improvements|Fixes|Misc)$/u.test(heading));
  if (unsupportedHeadings.length > 0) {
    throw new Error(`unsupported release-note headings: ${unsupportedHeadings.join(", ")}`);
  }
  const seenSections = new Set();
  let activeSection;
  let activeSectionEntries = 0;
  const finishSection = () => {
    if (activeSection && activeSectionEntries === 0) {
      throw new Error(`${activeSection} release-note section must contain at least one bullet`);
    }
  };
  for (const line of body.split("\n")) {
    const section = /^### (Improvements|Fixes|Misc)$/u.exec(line)?.[1];
    if (section) {
      finishSection();
      if (seenSections.has(section)) {
        throw new Error(`release-note section ${section} must not be repeated`);
      }
      seenSections.add(section);
      activeSection = section;
      activeSectionEntries = 0;
      continue;
    }
    if (!activeSection || line.trim() === "") continue;
    if (!/^- \S/u.test(line)) {
      throw new Error(`${activeSection} release-note entries must be one-line Markdown bullets`);
    }
    activeSectionEntries += 1;
  }
  finishSection();
  return Object.freeze({ body: `${body}\n`, title });
}

export function readReleaseNotes(version, root = repositoryRoot) {
  const notesPath = releaseNotesPath(version, root);
  return Object.freeze({ ...parseReleaseNotes(readFileSync(notesPath, "utf8")), notesPath });
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const command = process.argv[2];
  const version = argumentValue("--version");
  const root = path.resolve(argumentValue("--root") ?? repositoryRoot);
  const notes = readReleaseNotes(version, root);
  if (command === "title") {
    process.stdout.write(`${notes.title}\n`);
    return;
  }
  if (command === "body") {
    const output = argumentValue("--output");
    if (output) {
      writeFileSync(path.resolve(output), notes.body, "utf8");
    } else {
      process.stdout.write(notes.body);
    }
    return;
  }
  if (command === "validate") {
    process.stdout.write(`Validated ${path.relative(root, notes.notesPath)} (${notes.title}).\n`);
    return;
  }
  throw new Error("usage: release_notes.mjs <validate|title|body> --version X.Y.Z [--output path]");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
