/** Keeps the vendored code-review command and its cross-agent adapter aligned. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const command = readFileSync(
  resolve(repositoryRoot, ".agents/skills/code-review/commands/code-review.md"),
  "utf8",
);
const skill = readFileSync(resolve(repositoryRoot, ".agents/skills/code-review/SKILL.md"), "utf8");
const workflow = readFileSync(resolve(repositoryRoot, ".github/workflows/code-review.yml"), "utf8");

function markdownBody(source: string) {
  return source.replace(/^---\n[\s\S]*?\n---\n+/, "");
}

describe("code-review skill", () => {
  it("keeps the cross-agent skill adapter aligned with the vendored Claude command", () => {
    expect(markdownBody(skill)).toBe(markdownBody(command));
  });

  it("publishes a final result when a requested review has no findings", () => {
    expect(command).toContain(
      "If `--comment` argument IS provided and NO issues were found, post a summary comment",
    );
    expect(command).toContain("No issues found. Checked for bugs and CLAUDE.md compliance.");
    expect(workflow).toContain("prompt: '/code-review --comment ");
  });
});
