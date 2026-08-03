#!/usr/bin/env bun

/**
 * Translation sync script.
 *
 * Diffs the English locale file (source of truth) against each target
 * language file and uses OpenRouter to translate added/changed keys.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... bun run translate
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const LOCALES_DIR = path.resolve(import.meta.dirname, "../apps/web/src/locales");
const EN_FILE = path.join(LOCALES_DIR, "en.json");
const HASH_FILE = path.join(LOCALES_DIR, ".en-hashes.json");
const BATCH_SIZE = 50;
const MODEL = "google/gemini-3.1-flash-lite-preview"; // cost-effective translation model

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type FlatMap = Record<string, string>;

/** Flatten a nested JSON object into dot-separated keys. */
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

/** Unflatten dot-separated keys back into a nested object. */
function unflatten(flat: FlatMap): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
  return result;
}

function md5(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// OpenRouter translation
// ---------------------------------------------------------------------------
async function translateBatch(
  entries: [string, string][],
  targetLang: string,
  apiKey: string,
): Promise<Record<string, string>> {
  const keysAndValues = entries
    .map(([key, value]) => `"${key}": ${JSON.stringify(value)}`)
    .join(",\n  ");

  const prompt = `Translate the following JSON key-value pairs from English to ${targetLang}.
Return ONLY a valid JSON object with the same keys and translated values.
Preserve any interpolation placeholders like {{variable}} exactly as-is.
Do NOT translate proper nouns, brand names, or technical terms like "JSON", "API", "MVP".

{
  ${keysAndValues}
}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Output ONLY valid JSON, no markdown fences or extra text.`,
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = data.choices[0]?.message?.content?.trim() ?? "";

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse translation response as JSON: ${jsonStr}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENROUTER_API_KEY is required.");
    console.error("Pass it inline: OPENROUTER_API_KEY=... bun run translate");
    process.exit(1);
  }

  // Read source English file
  const enNested = readJson(EN_FILE);
  const enFlat = flatten(enNested);

  // Read or create hash file
  let hashes: Record<string, string> = {};
  if (fs.existsSync(HASH_FILE)) {
    hashes = readJson(HASH_FILE) as Record<string, string>;
  }

  // Discover target language files (everything except en.json and .en-hashes.json)
  const targetFiles = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith(".json") && f !== "en.json" && !f.startsWith("."));

  if (targetFiles.length === 0) {
    console.log("No target language files found. Nothing to sync.");
    return;
  }

  const LANG_NAMES: Record<string, string> = {
    fr: "French",
    es: "Spanish",
    de: "German",
    ja: "Japanese",
    zh: "Chinese",
    ko: "Korean",
    pt: "Portuguese",
    it: "Italian",
    nl: "Dutch",
    ru: "Russian",
  };

  for (const file of targetFiles) {
    const langCode = file.replace(".json", "");
    const langName = LANG_NAMES[langCode] ?? langCode;
    const targetPath = path.join(LOCALES_DIR, file);

    console.log(`\n--- Syncing ${langCode} (${langName}) ---`);

    const targetNested = readJson(targetPath);
    const targetFlat = flatten(targetNested);

    // Determine keys to translate
    const keysToTranslate: [string, string][] = [];
    const keysToRemove: string[] = [];

    // Find added keys (in en, not in target) and changed keys (hash differs)
    for (const [key, value] of Object.entries(enFlat)) {
      const currentHash = md5(value);
      if (!(key in targetFlat)) {
        // New key
        keysToTranslate.push([key, value]);
      } else if (hashes[key] && hashes[key] !== currentHash) {
        // English value changed since last translation
        keysToTranslate.push([key, value]);
      }
    }

    // Find removed keys (in target, not in en)
    for (const key of Object.keys(targetFlat)) {
      if (!(key in enFlat)) {
        keysToRemove.push(key);
      }
    }

    // Remove stale keys
    if (keysToRemove.length > 0) {
      console.log(`  Removing ${keysToRemove.length} stale key(s)`);
      for (const key of keysToRemove) {
        delete targetFlat[key];
      }
    }

    // Translate new/changed keys in batches
    if (keysToTranslate.length > 0) {
      console.log(`  Translating ${keysToTranslate.length} key(s)...`);
      for (let i = 0; i < keysToTranslate.length; i += BATCH_SIZE) {
        const batch = keysToTranslate.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(keysToTranslate.length / BATCH_SIZE);
        console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} keys)`);

        const translations = await translateBatch(batch, langName, apiKey);
        for (const [key] of batch) {
          if (key in translations) {
            targetFlat[key] = translations[key];
          } else {
            console.warn(`  Warning: No translation returned for key "${key}"`);
            // Keep existing or use English as fallback
            if (!(key in targetFlat)) {
              targetFlat[key] = enFlat[key];
            }
          }
        }
      }
    } else {
      console.log("  No keys to translate.");
    }

    // Ensure target has all en keys (reorder to match en key order)
    const orderedFlat: FlatMap = {};
    for (const key of Object.keys(enFlat)) {
      orderedFlat[key] = targetFlat[key] ?? enFlat[key];
    }

    // Write updated target file
    writeJson(targetPath, unflatten(orderedFlat));
    console.log(`  Written ${targetPath}`);
  }

  // Update hashes for all English keys
  const newHashes: Record<string, string> = {};
  for (const [key, value] of Object.entries(enFlat)) {
    newHashes[key] = md5(value);
  }
  writeJson(HASH_FILE, newHashes);
  console.log(`\nUpdated hash file: ${HASH_FILE}`);
  console.log("Done!");
}

main().catch((err) => {
  console.error("Translation sync failed:", err);
  process.exit(1);
});
