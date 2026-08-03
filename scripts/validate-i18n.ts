#!/usr/bin/env bun
/**
 * i18n validation script.
 *
 * Checks that all target locale files have the same keys as en.json.
 * Exits with code 1 if any mismatches are found.
 *
 * Usage:
 *   bun run validate:i18n
 *   bun scripts/validate-i18n.ts
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const LOCALES_DIR = path.resolve(import.meta.dirname, "../apps/web/src/locales");
const EN_FILE = path.join(LOCALES_DIR, "en.json");
const WEB_SRC_DIR = path.resolve(import.meta.dirname, "../apps/web/src");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type FlatMap = Record<string, string>;

function flatten(obj: Record<string, unknown>, prefix = ""): FlatMap {
  const result: FlatMap = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(result, flatten(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }
  return result;
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Walks a directory tree yielding every .ts / .tsx file path. Skips
 * node_modules, generated output, and locale data itself.
 */
function* walkSourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "locales") continue;
      yield* walkSourceFiles(full);
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

/**
 * Returns every static `t("…")` / `t('…')` key referenced in a file.
 * Template literals and variables are intentionally ignored — only
 * straight string-literal calls produce a key that can be matched
 * against en.json at build time.
 */
function extractStaticTKeys(src: string): Set<string> {
  const keys = new Set<string>();
  // Matches `t("foo.bar")` or `t('foo.bar')` — first arg only.
  const re = /\bt\(\s*(['"])([A-Za-z0-9_.-]+)\1/g;
  for (const match of src.matchAll(re)) {
    if (match[2]) keys.add(match[2]);
  }
  return keys;
}

const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"] as const;

/** True when `key` (or a plural variant of it) exists in en.json. */
function hasKeyOrPlural(key: string, enKeys: Set<string>): boolean {
  if (enKeys.has(key)) return true;
  return PLURAL_SUFFIXES.some((suffix) => enKeys.has(`${key}${suffix}`));
}

function validateStaticTCalls(enKeys: Set<string>): string[] {
  const errors: string[] = [];
  for (const file of walkSourceFiles(WEB_SRC_DIR)) {
    const src = fs.readFileSync(file, "utf-8");
    for (const key of extractStaticTKeys(src)) {
      if (!hasKeyOrPlural(key, enKeys)) {
        errors.push(`${path.relative(WEB_SRC_DIR, file)}: t("${key}") — key not in en.json`);
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const enFlat = flatten(readJson(EN_FILE));
  const enKeys = new Set(Object.keys(enFlat));

  const targetFiles = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".json") && f !== "en.json" && !f.startsWith("."));

  if (targetFiles.length === 0) {
    console.log("No target language files found. Nothing to validate.");
    return;
  }

  let hasErrors = false;

  for (const file of targetFiles) {
    const langCode = file.replace(".json", "");
    const targetPath = path.join(LOCALES_DIR, file);
    const targetFlat = flatten(readJson(targetPath));
    const targetKeys = new Set(Object.keys(targetFlat));

    const missingKeys = [...enKeys].filter((k) => !targetKeys.has(k));
    const extraKeys = [...targetKeys].filter((k) => !enKeys.has(k));

    if (missingKeys.length > 0 || extraKeys.length > 0) {
      hasErrors = true;
      console.error(`\n[${langCode}] Key mismatch in ${file}:`);
      if (missingKeys.length > 0) {
        console.error(`  Missing ${missingKeys.length} key(s):`);
        for (const key of missingKeys) {
          console.error(`    - ${key}`);
        }
      }
      if (extraKeys.length > 0) {
        console.error(`  Extra ${extraKeys.length} key(s):`);
        for (const key of extraKeys) {
          console.error(`    - ${key}`);
        }
      }
    } else {
      console.log(`[${langCode}] OK (${enKeys.size} keys)`);
    }
  }

  const staticErrors = validateStaticTCalls(enKeys);
  if (staticErrors.length > 0) {
    hasErrors = true;
    console.error(`\nFound ${staticErrors.length} static t() call(s) that reference missing keys:`);
    for (const err of staticErrors) console.error(`  - ${err}`);
  }

  if (hasErrors) {
    console.error("\ni18n validation failed. Run 'bun run translate' to sync translations.");
    process.exit(1);
  }

  console.log(`\ni18n validation passed (${enKeys.size} keys, all static t() calls resolved).`);
}

main();
