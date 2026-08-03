# workflow-code-review.md - local mirror of `.github/workflows/code-review.yml`

Authoritative prompt for Agent B. Locally, run a repo-aware code review against the current branch's diff vs `origin/main`, with no PR and no inline comments posted.

## Inputs

- Repo root: the current working directory.
- Diff target: `origin/main` (fetched by the orchestrator in Phase 1).
- Current branch: `git rev-parse --abbrev-ref HEAD`.

## Steps

1. Collect the full review surface:
   ```bash
   git diff origin/main -- .
   git ls-files --others --exclude-standard
   ```
   Use the two-dot working-tree form so uncommitted changes are included. For untracked files, read the file contents directly.

2. Collect the changed file list:
   ```bash
   git diff --name-only origin/main -- .
   git ls-files --others --exclude-standard
   ```

3. Read the project's own code-review skill and follow it literally: `.agents/skills/code-review/SKILL.md`.

4. Also apply repo-specific invariants from:
   - `AGENTS.md`
   - `.agents/rules/*.md`
   - `docs/TESTING.md`
   - domain docs relevant to changed files, such as `docs/ANALYTICS.md`, `docs/SECURITY.md`, and `docs/ONTOLOGY.md`

5. Produce findings grouped by severity. Nitpicks are allowed only if the cost to fix is trivial.

## Categories

Use one of: `correctness`, `maintainability`, `performance`, `security`, `style`, `testing`, `a11y`, `docs`.

Security overlaps with Agent C - if unsure, emit it in both and let the orchestrator dedupe by `(file, line, description)`.

## Severity

- `high` - a merge would introduce a bug, regression, or breaking change.
- `med` - a real issue that should be fixed before merging but is not breaking.
- `low` - a quality/clarity issue that could be addressed now or in a follow-up.
- `nit` - style / subjective.

## Reporting shape

Return exactly this JSON (one object, no prose):

```json
{
  "branch": "richardwu/foo",
  "base": "origin/main",
  "files_changed": 12,
  "findings": [
    {
      "id": "cr-1",
      "file": "apps/web/src/components/Foo.tsx",
      "line": 42,
      "severity": "high",
      "category": "correctness",
      "summary": "useEffect runs on every render because deps array is missing",
      "suggested_fix": "Add `[query]` as the dependency array, or replace with useMemo since this only derives state."
    }
  ]
}
```

## Rules

- Do **not** post PR comments. No PR exists; findings return to the orchestrator.
- Do **not** modify any file. Observation only.
- Do **not** flag things already covered by `bun run lint` or `bun run typecheck` unless the issue is a higher-level design or behavior concern.
- Stay within the diff. Do not review pre-existing code unless the diff meaningfully touches it.
- If the diff and untracked-file list are empty, return `{ "findings": [] }` and stop.
