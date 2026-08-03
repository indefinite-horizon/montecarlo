---
description: CI jobs must fail explicitly when required validation cannot run
globs: .github/workflows/*.yml
alwaysApply: false
---

# CI checks must never silently pass

In CI workflows:
- Every required check must actually validate something.
- If a prerequisite is missing, fail with a clear error instead of skipping and passing.
- Do not guard the core validation path with conditions that turn missing secrets, tools, or services into a green build.
- Do not catch failures and downgrade them to warnings when the job is supposed to gate correctness.
- Do not edit workflows to skip tests on pull requests, pushes, branches, paths, or matrix entries unless the user explicitly asks for that skip. If reducing CI coverage seems necessary, ask the user for confirmation before editing.

Bad patterns:
- `if: env.SOME_SECRET != ''` around the real check
- `if: github.event_name != 'pull_request'` around test jobs
- `exit 0` when a required tool is unavailable
- warning-only fallback paths for required CI validation
