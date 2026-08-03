---
name: fix-main-ci
description: Triage and fix broken CI on main by reading job logs, reproducing with the template's local commands, fixing the root cause, and rerunning the relevant gate.
---

# Fix Main CI

1. Confirm the failing branch and fetch the latest main.
2. Read failing GitHub Actions logs with `gh run view --log-failed`.
3. Reproduce locally with the matching command from `.github/workflows/ci.yml`.
4. Use `bash scripts/run_local.sh --command "bun run test:e2e:core:raw"` for browser failures that need a live local stack.
5. Fix the smallest root cause and rerun the failing command.
6. Report the failing job, root cause, changed files, and verification command.
