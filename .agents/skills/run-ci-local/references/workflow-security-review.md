# workflow-security-review.md - local mirror of `.github/workflows/security-review.yml`

Authoritative prompt for Agent C. The GitHub workflow verifies that the security-review skill exists. Locally, apply that project skill to the current branch's diff vs `origin/main`.

## Rubric source of truth

Read the project's own security-review skill and follow it literally: `.agents/skills/security-review/SKILL.md`.

That skill already defines:
- Analysis methodology (repo-context, comparative, vulnerability assessment)
- Vulnerability categories to check
- What NOT to report
- Confidence threshold (>80% exploitability)
- Severity levels (HIGH / MEDIUM only)

Do **not** duplicate or summarize that skill here - read it directly so we stay in sync if it changes.

## Inputs

- Diff:
  ```bash
  git diff origin/main -- .
  ```
- Untracked files:
  ```bash
  git ls-files --others --exclude-standard
  ```
- Repo root: cwd

Use the two-dot working-tree form so uncommitted changes are included. For untracked files, read the file contents directly.

## Differences from the GitHub workflow

The GitHub workflow only checks that the local project skill is present. Locally:
- No PR exists - do **not** try to `gh pr comment`.
- Return findings as structured JSON to the orchestrator.
- Skip any "post confirmation comment if clean" behavior - just return an empty `findings` array.

## Reporting shape

Return exactly this JSON (one object, no prose):

```json
{
  "branch": "richardwu/foo",
  "base": "origin/main",
  "files_changed": 12,
  "findings": [
    {
      "id": "sec-1",
      "severity": "HIGH",
      "file": "convex/actions/bar.ts",
      "line": 87,
      "description": "User-controlled input is concatenated into an HTTP URL without validation, enabling SSRF to internal services.",
      "exploit_scenario": "A user sends a crafted workspaceSlug value like 'foo/../../169.254.169.254/latest/meta-data/' that bypasses the workspace lookup and fetches instance metadata through the action's HTTP client.",
      "suggested_fix": "Validate the slug with the same regex used in `convex/schema.ts` before interpolating, or switch to an allow-listed base URL plus safe path joining."
    }
  ]
}
```

## Rules

- **Confidence threshold:** only flag findings you would defend in a security review with >80% confidence of real exploitability.
- **Severity:** HIGH or MEDIUM only - no low. If it would not be HIGH/MEDIUM, omit it.
- **Exploit scenario is mandatory.** Abstract risk descriptions without a concrete attack path are out.
- Do **not** post PR comments, create files, or modify code. Observation only.
- Do **not** run tools beyond what the security-review skill needs (`git diff`, `rg`, `gh` read-only).
- If the diff and untracked-file list are empty, return `{ "findings": [] }` and stop.
