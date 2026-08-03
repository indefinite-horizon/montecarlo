---
name: run-ci-local
description: "Run all in-scope GitHub Actions checks locally against the current branch before push. Fans out one pass per in-scope workflow (ci.yml, code-review.yml, security-review.yml), then loops on review findings. Use ONLY when the user explicitly invokes via '/run-ci-local', 'run CI locally', or 'check everything before push' - do NOT trigger proactively on commits, pushes, or PR creation."
---

# Run CI Local

Mirror the in-scope `.github/workflows/*.yml` locally, including the placeholder review workflows, then iterate on review findings until the branch is ready to push.

**Invocation is explicit only - never auto-trigger.** This skill performs a heavy, long-running workflow (full Playwright suite, multiple review passes, and possible code edits) that should never run without the user asking for it by name.

## Workflows in scope

| Agent | Workflow | Reference |
|-------|----------|-----------|
| **A** | `ci.yml` - audit, lint, typecheck, test, integration test, build, convex-codegen, validate-i18n, e2e-core, e2e-perf, e2e-external | [references/workflow-ci.md](references/workflow-ci.md) |
| **B** | `code-review.yml` - local code review of current branch diff vs `origin/main` | [references/workflow-code-review.md](references/workflow-code-review.md) |
| **C** | `security-review.yml` - local security review of current branch diff vs `origin/main`, applying the repo security-review skill instead of only checking that it exists | [references/workflow-security-review.md](references/workflow-security-review.md) |

**Out of scope:** `claude.yml` (triggered by @claude mention only), `nightly-e2e.yml` (cron-oriented), and `address-unresolved-pr-reviews.yml` (separate maintenance workflow).

## Phase 1 - Prep

Do these in order before dispatching review/check passes.

**Diff target is always the current working tree vs `origin/main`, unless the user specifies otherwise.** This holds even when:
- There are zero commits ahead of `origin/main` (all changes are uncommitted / unstaged).
- There is no open PR.
- The working tree is dirty.

Do **not** stop, prompt, or skip the run because the branch "has nothing to review." The review surface is `git diff origin/main -- .` plus any untracked files the user has added. Only bail if the user explicitly redirects the diff base or asks to abort.

1. **Infer the branch goal - do NOT ask the user.** Derive a one-sentence working goal from:
   - the branch name (`git branch --show-current`),
   - recent branch commit titles (`git log --oneline origin/main..HEAD`),
   - a quick scan of `git diff --stat origin/main` plus any untracked files.
   Record the inferred goal verbatim and use it as `branch_goal` for Phase 3 triage. State the inferred goal in one line to the user as an FYI, but **do not block on confirmation** - proceed straight to the next step. If the user later corrects it mid-run, update `branch_goal` and continue.
2. **Sanity-check git.** `git status --porcelain` - record dirty state but **proceed regardless**. The skill runs what's on disk, including uncommitted edits and untracked files.
3. **Fetch main.** `git fetch origin main --quiet` - the review passes diff against `origin/main`.

## Phase 2 - Fan out checks and reviews

Prefer running A, B, and C concurrently when an agent fan-out tool is available. If no sub-agent tool is available, run them sequentially in the current session and keep the same reporting contract. Each pass is read-only in this phase - observation only, no code changes.

Agent A mirrors the actual `ci.yml` command map for this template. Do not import app-specific docker commands from other repos unless this repo adds matching scripts; this template's e2e jobs run through `scripts/prepare_e2e_env.sh` and `bun run test:e2e:*:ci`.

### Agent A prompt skeleton

```
You are mirroring .github/workflows/ci.yml locally for the current branch.

Follow the command map in .agents/skills/run-ci-local/references/workflow-ci.md
exactly. Run jobs in the order and groupings listed there.
For each job: capture exit code, wall-clock duration, and the last ~40 lines
of combined stdout/stderr.

Return a single JSON block:
{ "jobs": [ { "name": "lint", "status": "pass|fail", "duration_s": 12, "tail": "..." }, ... ] }

Constraints:
- Observation only. Do NOT attempt fixes. Do NOT modify any file.
```

### Agent B prompt skeleton

```
You are mirroring .github/workflows/code-review.yml locally - against
the current branch's diff vs origin/main, with no PR required.

Follow .agents/skills/run-ci-local/references/workflow-code-review.md.

Return a single JSON block:
{ "findings": [
    { "id": "cr-1", "file": "...", "line": 123, "severity": "high|med|low|nit",
      "category": "correctness|maintainability|...", "summary": "...",
      "suggested_fix": "..." },
    ... ]
}

Constraints: observation only. Do NOT modify code.
```

### Agent C prompt skeleton

```
You are mirroring .github/workflows/security-review.yml locally - against the
current branch's diff vs origin/main, with no PR required.

Follow .agents/skills/run-ci-local/references/workflow-security-review.md.

Return a single JSON block:
{ "findings": [
    { "id": "sec-1", "severity": "HIGH|MEDIUM", "file": "...", "line": 123,
      "description": "...", "exploit_scenario": "...", "suggested_fix": "..." },
    ... ]
}

Constraints: observation only. Do NOT modify code. Only HIGH/MEDIUM with >80%
exploitability confidence per the security-review skill rules.
```

Wait for all three to return before moving to Phase 3.

## Phase 3 - Triage + fix loop

See [references/review-fix-loop.md](references/review-fix-loop.md) for the full contract. Summary:

1. **Merge** findings from B and C into one list.
2. **Classify** each against the stored branch goal:
   - **actionable** - fix it now.
   - **contradictory** - finding opposes the stated branch goal; record the reason verbatim and skip.
   - **out-of-scope** - valid concern but unrelated to this branch's changes; record and skip.
3. **Fix actionable findings** directly. Also fix anything Agent A reported as `fail`.
4. **Re-run the minimal subset** of Agent A's jobs that the fixes could have affected (always: `lint`, `typecheck`, `test`; plus any e2e suite whose spec file was touched or whose app/components/convex dependency was modified).
5. **Re-run Agents B and C** on the new diff.
6. **Loop.** Continue until the new review runs produce no new actionable findings AND all of Agent A's jobs pass.
7. **Cap at 5 rounds.** If round 5 still yields new actionable findings, stop and report the remaining items.

## Phase 4 - Report

Emit a single final report to the user:

- **ci.yml** - per-job status table (pass / fail / skipped-why)
- **code-review** - fixed: N, contradictory: N (bullet list of each with reason), out-of-scope: N
- **security-review** - fixed: N, contradictory: N (with reason), out-of-scope: N
- **Rounds used** - N / 5
- **Next steps** - any remaining items the user must decide on

## Non-goals

- Do **not** push, create PRs, tag, or trigger any remote CI.
- Do **not** run `claude.yml`, `nightly-e2e.yml`, or `address-unresolved-pr-reviews.yml`.
- Do **not** modify workflow files.
- Do **not** silently skip e2e if setup fails - stop and surface the failure.
- Do **not** mark a finding contradictory without a written reason tied to the stored branch goal.
