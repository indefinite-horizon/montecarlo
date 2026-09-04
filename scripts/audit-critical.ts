#!/usr/bin/env bun
/** Fails CI for high or critical dependency advisories. */

import { readFileSync } from "node:fs";
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

interface OsvSeverityGroup {
  ids?: unknown;
  max_severity?: unknown;
}

interface OsvVulnerability {
  id?: unknown;
  database_specific?: unknown;
}

function parseAuditJson(output: string): Record<string, Advisory[]> {
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("bun audit did not emit parseable JSON output");
  }
  const parsed: unknown = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("bun audit emitted an unexpected JSON report");
  }

  const advisories: Record<string, Advisory[]> = {};
  for (const [packageName, packageAdvisories] of Object.entries(parsed)) {
    if (
      !Array.isArray(packageAdvisories) ||
      packageAdvisories.some(
        (advisory) => advisory === null || typeof advisory !== "object" || Array.isArray(advisory),
      )
    ) {
      throw new Error("bun audit emitted an unexpected JSON report");
    }
    advisories[packageName] = packageAdvisories as Advisory[];
  }
  return advisories;
}

function decodeOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBlockedOsvSeverity(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "critical") return true;
  const score = Number(normalized);
  return Number.isFinite(score) && score >= 7;
}

export function evaluateRootAudit(output: string, exitCode: number, errorOutput: string): string[] {
  const advisories = parseAuditJson(output);
  const blockedAdvisories: string[] = [];
  let advisoryCount = 0;

  for (const [packageName, packageAdvisories] of Object.entries(advisories)) {
    for (const advisory of packageAdvisories) {
      advisoryCount += 1;
      if (advisory.severity !== "high" && advisory.severity !== "critical") continue;
      const summary = `${packageName}: ${advisory.title ?? `${advisory.severity} advisory`} (${advisory.url ?? "no URL"})`;
      blockedAdvisories.push(summary);
    }
  }

  if (exitCode !== 0 && advisoryCount === 0) {
    throw new Error(`bun audit failed: ${errorOutput.trim() || "unknown error"}`);
  }

  return blockedAdvisories;
}

export function evaluateOsvAudit(output: string, scannerFailed = false): string[] {
  const report: unknown = JSON.parse(output);
  if (!isRecord(report) || !Array.isArray(report.results)) {
    throw new Error("OSV-Scanner emitted an unexpected JSON report");
  }

  const blockedAdvisories = new Map<string, string>();
  let vulnerabilityCount = 0;
  for (const result of report.results) {
    if (!isRecord(result) || !Array.isArray(result.packages)) {
      throw new Error("OSV-Scanner emitted an unexpected JSON report");
    }

    for (const packageResult of result.packages) {
      if (!isRecord(packageResult) || !isRecord(packageResult.package)) {
        throw new Error("OSV-Scanner emitted an unexpected JSON report");
      }
      const packageName = packageResult.package.name;
      const groups = packageResult.groups;
      const vulnerabilities = packageResult.vulnerabilities;
      if (
        typeof packageName !== "string" ||
        !Array.isArray(groups) ||
        !Array.isArray(vulnerabilities)
      ) {
        throw new Error("OSV-Scanner emitted an unexpected JSON report");
      }

      for (const rawGroup of groups) {
        const group = rawGroup as OsvSeverityGroup;
        if (
          !isRecord(group) ||
          !Array.isArray(group.ids) ||
          group.ids.some((id) => typeof id !== "string")
        ) {
          throw new Error("OSV-Scanner emitted an unexpected JSON report");
        }
        if (!isBlockedOsvSeverity(group.max_severity)) continue;
        for (const id of group.ids as string[]) {
          blockedAdvisories.set(
            `${packageName}:${id}`,
            `${packageName}: ${id} (OSV severity ${group.max_severity})`,
          );
        }
      }

      for (const rawVulnerability of vulnerabilities) {
        vulnerabilityCount += 1;
        const vulnerability = rawVulnerability as OsvVulnerability;
        if (!isRecord(vulnerability) || typeof vulnerability.id !== "string") {
          throw new Error("OSV-Scanner emitted an unexpected JSON report");
        }
        const databaseSpecific = vulnerability.database_specific;
        if (isRecord(databaseSpecific) && isBlockedOsvSeverity(databaseSpecific.severity)) {
          const key = `${packageName}:${vulnerability.id}`;
          if (!blockedAdvisories.has(key)) {
            blockedAdvisories.set(key, `${packageName}: ${vulnerability.id} (OSV high severity)`);
          }
        }
      }
    }
  }

  if (scannerFailed && vulnerabilityCount === 0) {
    throw new Error("OSV-Scanner failed without reporting vulnerabilities");
  }

  return [...blockedAdvisories.values()];
}

function auditRootDependencies(osvReportPath?: string, osvScannerFailed = false): string[] {
  if (osvReportPath) {
    return evaluateOsvAudit(readFileSync(osvReportPath, "utf8"), osvScannerFailed);
  }

  const audit = Bun.spawnSync(["bun", "audit", "--audit-level=high", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  return evaluateRootAudit(decodeOutput(audit.stdout), audit.exitCode, decodeOutput(audit.stderr));
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
  const reportFlagIndex = process.argv.indexOf("--osv-report");
  const osvReportPath = reportFlagIndex === -1 ? undefined : process.argv[reportFlagIndex + 1];
  if (reportFlagIndex !== -1 && !osvReportPath) {
    throw new Error("--osv-report requires a report path");
  }
  const outcomeFlagIndex = process.argv.indexOf("--osv-scan-outcome");
  const osvScanOutcome = outcomeFlagIndex === -1 ? undefined : process.argv[outcomeFlagIndex + 1];
  if (outcomeFlagIndex !== -1 && osvScanOutcome !== "success" && osvScanOutcome !== "failure") {
    throw new Error("--osv-scan-outcome must be success or failure");
  }

  const blockedAdvisories = osvReportPath
    ? auditRootDependencies(osvReportPath, osvScanOutcome === "failure")
    : [...auditRootDependencies(), ...auditDesktopConvexBundle()];

  if (blockedAdvisories.length > 0) {
    console.error("High-severity dependency audit failed:");
    for (const advisory of blockedAdvisories) console.error(`- ${advisory}`);
    process.exit(1);
  }

  console.log("High-severity dependency audit passed.");
}

if (import.meta.main) main();
