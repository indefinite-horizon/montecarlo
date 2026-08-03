# review-fix-loop.md - Phase 3 contract

Runs after Agents B and C return findings in Phase 2. The orchestrator drives this loop directly, because fixes touch code and need unified judgment.

## Inputs

- `branch_goal` (string) - inferred in Phase 1 from branch name, commit titles, and diff summary (not user-prompted).
- `ci_report` - Agent A's JSON (`{ jobs: [...] }`).
- `code_review_findings` - Agent B's `findings` array.
- `security_findings` - Agent C's `findings` array.

## Merge + dedupe

Combine B and C into one list. Dedupe on `(file, line, short_hash(description))`: if the same location produces both a code-review and security finding, keep the security one (higher precedence) but copy any unique context from the code-review one into `merged_context`.

## Triage

For each finding, assign exactly one classification:

### `contradictory`

The finding opposes the stored `branch_goal`. Example: branch goal is *"remove the legacy retry middleware"*, and a finding says *"add retry logic around this call"* - contradictory.

Required: write the reason in one sentence, referencing the branch goal verbatim. Skip the fix.

### `out-of-scope`

The finding is valid but the root cause lives outside the branch's diff, OR the fix would meaningfully expand the branch's blast radius. Example: a pre-existing N+1 query in a file the branch only renamed.

Required: one sentence explaining why it's unrelated. Skip the fix. Add to final report for a follow-up issue.

### `actionable` (default)

Everything else. Apply the fix.

**Default to `actionable`.** Use `contradictory` and `out-of-scope` sparingly - the user explicitly asked for findings to be addressed, not deferred.

## Fix

- Apply fixes for all `actionable` findings.
- Apply fixes for every Agent A job with `status: fail`. Read the tail, debug, fix.
- Keep each fix minimal. Do not refactor adjacent code unless the fix strictly requires it.
- Stage changes as you go (`git add -p`-style discipline - no unrelated files).
- **Commit policy:** the orchestrator may create fix-up commits with short messages as it goes, but must never push, amend already-pushed commits, or touch `.github/workflows/*.yml`. Pushing is a follow-up that the user performs, not this skill.

## Re-run

After fixes, the orchestrator re-runs a minimal subset of Agent A's jobs, plus Agents B and C.

**Always re-run (Agent A subset):**
- `lint`
- `typecheck`
- `test`

**Conditionally re-run (Agent A subset):**
- `integration-test` - if Convex, auth, analytics, or cross-process behavior changed.
- `build` - if any file under `apps/web/`, `components/`, or shared frontend config changed.
- `convex-codegen` - if any file under `convex/` changed.
- `validate-i18n` - if locale JSON or any file calling `t(...)` changed.
- `e2e-core` / `e2e-perf` / `e2e-external` - if a spec in that suite changed, or if a file that spec transitively depends on changed (err toward running more rather than fewer e2e suites if in doubt).

Running the full Agent A again is fine when in doubt - missing a regression defeats the skill.

**Always re-run Agents B and C** on the fresh diff.

## Loop exit

Exit when **all** are true:
- Agent A's last run has every job in `pass` or `skipped` (justified).
- Agents B and C's last runs produced zero new `actionable` findings. Findings unchanged from the previous round that were already `contradictory` or `out-of-scope` do not count as new.

If not all are true, increment `round` and repeat Fix -> Re-run.

## Cap

**5 rounds max.** If round 5 ends and there are still new actionable findings, stop and escalate to the user in Phase 4's report. Do not silently truncate.

## Invariants

- Never mark something `contradictory` without a reason that quotes the branch goal.
- Never mark something `out-of-scope` without a reason explaining why the fix would expand the branch's scope.
- Never skip a HIGH-severity security finding as `out-of-scope` unless demonstrably pre-existing. If pre-existing, still fix unless the user agreed to defer.
- Never touch workflow files (`.github/workflows/*.yml`) in Phase 3.
