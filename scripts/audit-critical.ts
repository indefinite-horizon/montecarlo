#!/usr/bin/env bun
/** Runs the critical dependency audit. */

interface Advisory {
  id?: number;
  url?: string;
  title?: string;
  severity?: string;
  vulnerable_versions?: string;
}

function parseAuditJson(output: string): Record<string, Advisory[]> {
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("bun audit did not emit parseable JSON output");
  }
  return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
}

function main() {
  const audit = Bun.spawnSync(["bun", "audit", "--audit-level=critical", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  const output = decoder.decode(audit.stdout);
  const advisories = parseAuditJson(output);
  const unignoredCriticals: string[] = [];

  for (const [packageName, packageAdvisories] of Object.entries(advisories)) {
    for (const advisory of packageAdvisories) {
      if (advisory.severity !== "critical") continue;
      const summary = `${packageName}: ${advisory.title ?? "critical advisory"} (${advisory.url ?? "no URL"})`;
      unignoredCriticals.push(summary);
    }
  }

  if (unignoredCriticals.length > 0) {
    console.error("Critical dependency audit failed:");
    for (const critical of unignoredCriticals) console.error(`- ${critical}`);
    process.exit(1);
  }

  console.log("Critical dependency audit passed.");
}

main();
