/** Protects the dotenv ownership boundary used by local Convex uploads. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const filterScript = resolve(import.meta.dirname, "../scripts/filter_convex_env.sh");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("filter_convex_env.sh", () => {
  it("keeps Convex-owned values and drops runtime, browser, and unknown values", () => {
    const directory = mkdtempSync(join(tmpdir(), "montecarlo-env-filter-"));
    temporaryDirectories.push(directory);
    const envFile = join(directory, ".env.local");
    writeFileSync(
      envFile,
      [
        "SITE_URL=http://localhost:5173",
        "export BETTER_AUTH_SECRET=convex-secret",
        "MONTECARLO_BLOB_ATTESTATION_PUBLIC_KEY=public-key",
        "MONTECARLO_BLOB_ATTESTATION_PRIVATE_KEY=runtime-private-key",
        "OPENROUTER_API_KEY=provider-secret",
        "R2_SECRET_ACCESS_KEY=storage-secret",
        "CONVEX_DEPLOY_KEY=deployment-secret",
        "VITE_RUNTIME_TOKEN=browser-value",
        "UNREVIEWED_ENVIRONMENT_VALUE=unknown",
        "",
      ].join("\n"),
    );

    const output = execFileSync("bash", [filterScript, envFile], { encoding: "utf8" });

    expect(output).toContain("SITE_URL=http://localhost:5173");
    expect(output).toContain("export BETTER_AUTH_SECRET=convex-secret");
    expect(output).toContain("MONTECARLO_BLOB_ATTESTATION_PUBLIC_KEY=public-key");
    expect(output).not.toContain("runtime-private-key");
    expect(output).not.toContain("provider-secret");
    expect(output).not.toContain("storage-secret");
    expect(output).not.toContain("deployment-secret");
    expect(output).not.toContain("browser-value");
    expect(output).not.toContain("UNREVIEWED_ENVIRONMENT_VALUE");
  });
});
