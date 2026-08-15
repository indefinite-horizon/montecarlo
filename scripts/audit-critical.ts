#!/usr/bin/env bun
/** Fails CI for high or critical dependency advisories. */

import { fileURLToPath } from "node:url";

interface Advisory {
  id?: number;
  url?: string;
  title?: string;
  severity?: string;
  vulnerable_versions?: string;
}

interface NpmVulnerability {
  name?: string;
  severity?: string;
  via?: Array<string | { title?: string; url?: string }>;
}

function parseAuditJson(output: string): Record<string, Advisory[]> {
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("bun audit did not emit parseable JSON output");
  }
  return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
}

function decodeOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output);
}

function auditRootDependencies(): string[] {
  const audit = Bun.spawnSync(["bun", "audit", "--audit-level=high", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const advisories = parseAuditJson(decodeOutput(audit.stdout));
  const blockedAdvisories: string[] = [];

  for (const [packageName, packageAdvisories] of Object.entries(advisories)) {
    for (const advisory of packageAdvisories) {
      if (advisory.severity !== "high" && advisory.severity !== "critical") continue;
      const summary = `${packageName}: ${advisory.title ?? `${advisory.severity} advisory`} (${advisory.url ?? "no URL"})`;
      blockedAdvisories.push(summary);
    }
  }

  if (audit.exitCode !== 0 && blockedAdvisories.length === 0) {
    throw new Error(`bun audit failed: ${decodeOutput(audit.stderr).trim() || "unknown error"}`);
  }

  return blockedAdvisories;
}

function auditDesktopConvexBundle(): string[] {
  const bundleDirectory = fileURLToPath(new URL("../apps/desktop/convex-bundle/", import.meta.url));
  const audit = Bun.spawnSync(["npm", "audit", "--audit-level=high", "--omit=dev", "--json"], {
    cwd: bundleDirectory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = decodeOutput(audit.stdout);
  const report = JSON.parse(output) as { vulnerabilities?: Record<string, NpmVulnerability> };
  const blockedAdvisories: string[] = [];

  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    if (vulnerability.severity !== "high" && vulnerability.severity !== "critical") continue;
    const advisory = vulnerability.via?.find(
      (entry): entry is { title?: string; url?: string } => typeof entry === "object",
    );
    blockedAdvisories.push(
      `desktop Convex bundle/${packageName}: ${advisory?.title ?? `${vulnerability.severity} advisory`} (${advisory?.url ?? "no URL"})`,
    );
  }

  if (audit.exitCode !== 0 && blockedAdvisories.length === 0) {
    throw new Error(`npm audit failed: ${decodeOutput(audit.stderr).trim() || output.trim()}`);
  }

  return blockedAdvisories;
}

function main() {
  const blockedAdvisories = [...auditRootDependencies(), ...auditDesktopConvexBundle()];

  if (blockedAdvisories.length > 0) {
    console.error("High-severity dependency audit failed:");
    for (const advisory of blockedAdvisories) console.error(`- ${advisory}`);
    process.exit(1);
  }

  console.log("High-severity dependency audit passed.");
}

main();
