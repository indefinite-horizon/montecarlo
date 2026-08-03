---
description: New backend env vars must be declared in convex/env.ts; setup_local_env.sh syncs env files wholesale
globs: convex/env.ts,scripts/setup_local_env.sh
alwaysApply: false
---

# Keep backend env vars explicit in convex/env.ts

When adding a new environment variable to the Convex backend:

1. **`convex/env.ts`** — add the var to the `cleanEnv(...)` call so the runtime validates it on startup.
2. **`scripts/setup_local_env.sh`** — do not add per-var allowlists. The script uploads the selected env file with `convex env set --from-file`, and the Convex CLI skips CLI-managed variables.

Every backend env var required by runtime code must be declared in `convex/env.ts` unless there is a documented reason to read it directly from `process.env`.
