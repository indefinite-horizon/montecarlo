#!/usr/bin/env bun
/** Lightweight project-specific lint rules for the reusable template. */

import fs from "node:fs";
import path from "node:path";

type Finding = {
  rule: string;
  file: string;
  line: number;
  message: string;
};

const ROOT = path.resolve(import.meta.dirname, "..");
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".cjs", ".json"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".cjs"]);
const SKIP_DIRS = new Set([
  ".agents",
  ".claude",
  ".context",
  ".convex",
  ".codex",
  ".cursor",
  ".dev",
  ".expect",
  ".gemini",
  ".git",
  ".opencode",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const GENERATED_PATHS = [/^convex\/_generated\//, /^apps\/web\/src\/routeTree\.gen\.ts$/];

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isGenerated(relativePath: string): boolean {
  return GENERATED_PATHS.some((pattern) => pattern.test(relativePath));
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relativePath = toPosix(path.relative(ROOT, fullPath));
    if (isGenerated(relativePath)) continue;
    if (TEXT_EXTENSIONS.has(path.extname(entry.name))) yield fullPath;
  }
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function add(findings: Finding[], rule: string, file: string, line: number, message: string): void {
  findings.push({ rule, file, line, message });
}

function hasDescription(source: string): boolean {
  const trimmed = source.startsWith("#!")
    ? source.slice(source.indexOf("\n") + 1).trimStart()
    : source.trimStart();
  return trimmed.startsWith("/**") || trimmed.startsWith("// biome-ignore-all");
}

function checkSourceFileDescription(
  findings: Finding[],
  relativePath: string,
  source: string,
): void {
  if (relativePath.startsWith("vendor/")) return;
  if (relativePath.endsWith(".d.ts")) return;
  if (!SOURCE_EXTENSIONS.has(path.extname(relativePath))) return;
  if (!hasDescription(source)) {
    add(
      findings,
      "source-file-description",
      relativePath,
      1,
      "source files must start with a short file description comment",
    );
  }
}

function checkFileSize(findings: Finding[], relativePath: string, source: string): void {
  if (relativePath.startsWith("vendor/")) return;
  const lines = source.split("\n").length;
  const limit = relativePath.startsWith("scripts/") ? 1200 : 700;
  if (lines > limit) {
    add(
      findings,
      "file-size-limit",
      relativePath,
      limit + 1,
      `file has ${lines} lines; limit is ${limit}`,
    );
  }
}

function checkNoEmptyIdFallback(findings: Finding[], relativePath: string, source: string): void {
  const patterns = [/Id<[^>]+>\s*\|\|\s*""/, /as\s+Id<[^>]+>\s*\|\|\s*""/, /\?\?\s*""\s+as\s+Id</];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) {
      add(
        findings,
        "no-empty-id-fallback",
        relativePath,
        lineNumber(source, match.index),
        "do not use empty strings as Convex id fallbacks",
      );
    }
  }
}

function checkNoBareConsole(findings: Finding[], relativePath: string, source: string): void {
  if (relativePath.startsWith("scripts/") || relativePath.startsWith("tests/")) return;
  if (relativePath === "convex/lib/logger.ts") return;
  const regex = /\bconsole\.(log|warn|error|info|debug)\s*\(/g;
  for (const match of source.matchAll(regex)) {
    add(
      findings,
      "no-bare-console",
      relativePath,
      lineNumber(source, match.index ?? 0),
      "use structured logging or user-visible feedback instead of console calls",
    );
  }
}

function checkNoDirectStorageUrl(findings: Finding[], relativePath: string, source: string): void {
  const regex = /\.storage\.getUrl\s*\(/g;
  for (const match of source.matchAll(regex)) {
    add(
      findings,
      "no-direct-storage-url",
      relativePath,
      lineNumber(source, match.index ?? 0),
      "wrap storage URL reads in an app helper before exposing them",
    );
  }
}

function checkNoDirectUseEffect(findings: Finding[], relativePath: string, source: string): void {
  if (!relativePath.endsWith(".tsx") && !relativePath.endsWith(".ts")) return;
  if (/src\/hooks\/use[A-Z]/.test(relativePath)) return;
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (!/\buseEffect\s*\(/.test(lines[index] ?? "")) continue;
    const context = lines.slice(Math.max(0, index - 4), index + 1).join("\n");
    if (context.includes("lint-allow: no-direct-use-effect")) continue;
    add(
      findings,
      "no-direct-use-effect",
      relativePath,
      index + 1,
      "prefer event handlers or custom hooks; add a lint-allow comment for mount/bridge effects",
    );
  }
}

function checkRequireMemoComponent(
  findings: Finding[],
  relativePath: string,
  source: string,
): void {
  if (!relativePath.startsWith("apps/web/src/components/") || !relativePath.endsWith(".tsx"))
    return;
  if (relativePath.includes("/ui/")) return;
  if (source.includes("memo(")) return;
  add(
    findings,
    "require-memo-component",
    relativePath,
    1,
    "exported React components should be memo-wrapped unless they are primitives",
  );
}

function checkSchemaNaming(findings: Finding[], relativePath: string, source: string): void {
  if (relativePath !== "convex/schema.ts") return;
  const tableRegex = /^\s*([A-Za-z0-9_]+):\s*defineTable/gm;
  for (const match of source.matchAll(tableRegex)) {
    const tableName = match[1] ?? "";
    if (!/^[a-z][a-z0-9_]*$/.test(tableName)) {
      add(
        findings,
        "schema-table-naming",
        relativePath,
        lineNumber(source, match.index ?? 0),
        `table '${tableName}' must be snake_case`,
      );
    }
  }
  const indexRegex = /\.index\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(indexRegex)) {
    const indexName = match[1] ?? "";
    if (!/^by_[a-z0-9_]+$/.test(indexName)) {
      add(
        findings,
        "schema-index-naming",
        relativePath,
        lineNumber(source, match.index ?? 0),
        `index '${indexName}' must start with by_ and be snake_case`,
      );
    }
  }
}

function checkNoDeadConvexIndex(findings: Finding[], relativePath: string, source: string): void {
  if (relativePath !== "convex/schema.ts") return;
  const indexes = [...source.matchAll(/\.index\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter(Boolean);
  const allSource = [...walk(ROOT)]
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
    .map((file) => fs.readFileSync(file, "utf-8"))
    .join("\n");
  for (const indexName of indexes) {
    if (!allSource.includes(`"${indexName}"`) && !allSource.includes(`'${indexName}'`)) {
      add(
        findings,
        "no-dead-convex-index",
        relativePath,
        1,
        `index '${indexName}' is declared but not referenced`,
      );
    }
  }
}

function checkVercelSecurityHeaders(findings: Finding[]): void {
  const filePath = path.join(ROOT, "vercel.json");
  const relativePath = "vercel.json";
  if (!fs.existsSync(filePath)) {
    add(findings, "vercel-security-headers", relativePath, 1, "vercel.json is required");
    return;
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  for (const header of ["X-Content-Type-Options", "Referrer-Policy", "Content-Security-Policy"]) {
    if (!raw.includes(header)) {
      add(findings, "vercel-security-headers", relativePath, 1, `missing ${header}`);
    }
  }
}

function checkNoDirectAnalyticsImport(
  findings: Finding[],
  relativePath: string,
  source: string,
): void {
  const isAllowed =
    relativePath.startsWith("apps/web/src/lib/analytics/") ||
    relativePath === "convex/actions/analyticsFlushNode.ts" ||
    relativePath.startsWith("tests/");
  if (isAllowed) return;
  if (/from\s+["']posthog-js["']|from\s+["']posthog-node["']/.test(source)) {
    add(
      findings,
      "no-direct-analytics-import",
      relativePath,
      1,
      "analytics SDK imports must stay behind adapter/outbox boundaries",
    );
  }
}

function main(): void {
  const findings: Finding[] = [];
  for (const file of walk(ROOT)) {
    const relativePath = toPosix(path.relative(ROOT, file));
    const source = fs.readFileSync(file, "utf-8");
    checkSourceFileDescription(findings, relativePath, source);
    checkFileSize(findings, relativePath, source);
    checkNoEmptyIdFallback(findings, relativePath, source);
    checkNoBareConsole(findings, relativePath, source);
    checkNoDirectStorageUrl(findings, relativePath, source);
    checkNoDirectUseEffect(findings, relativePath, source);
    checkRequireMemoComponent(findings, relativePath, source);
    checkSchemaNaming(findings, relativePath, source);
    checkNoDirectAnalyticsImport(findings, relativePath, source);
  }
  checkNoDeadConvexIndex(
    findings,
    "convex/schema.ts",
    fs.readFileSync(path.join(ROOT, "convex/schema.ts"), "utf-8"),
  );
  checkVercelSecurityHeaders(findings);

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} ${finding.rule} ${finding.message}`);
    }
    process.exit(1);
  }
  console.log("custom lint passed");
}

main();
