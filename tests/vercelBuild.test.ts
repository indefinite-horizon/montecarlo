/** Guards the Vercel production Convex deploy flags. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const vercelBuildScript = readFileSync(
  resolve(import.meta.dirname, "../scripts/vercel_build.sh"),
  "utf8",
);

describe("scripts/vercel_build.sh", () => {
  it("confirms large index deletion on non-interactive production deploys", () => {
    expect(vercelBuildScript).toContain(
      "bunx convex deploy --typecheck enable --allow-deleting-large-indexes --cmd 'bun run build:web'",
    );
  });

  it("does not pass the production-only index flag to preview deploys", () => {
    const previewDeployLine = vercelBuildScript
      .split("\n")
      .find((line) => line.includes("--preview-name"));

    expect(previewDeployLine).toBeDefined();
    expect(previewDeployLine).not.toContain("--allow-deleting-large-indexes");
  });
});
