---
description: Keep env ownership, validation, local setup, and prod/preview deployment scripts synchronized
globs: .env.example,SECRETS.md,convex/env.ts,scripts/filter_convex_env.sh,scripts/setup_local_env.sh,scripts/generate_deploy_env.sh,scripts/set_convex_deploy_env.sh,scripts/set_vercel_deploy_env.sh,scripts/vercel_build.sh
alwaysApply: false
---

# Keep environment variables synchronized across every owner

Whenever an environment variable is added, renamed, removed, or changes owner:

1. Update **`SECRETS.md`** and **`.env.example`** together. Keep credentials grouped by owner and never add real values, fragments, hashes, lengths, or screenshots.
2. Declare Convex backend variables in **`convex/env.ts`** so startup validates them, unless a documented exception requires a direct `process.env` read.
3. Update **`scripts/filter_convex_env.sh`** when Convex ownership changes. Never allow runtime-only or deployment-only secrets through this filter.
4. Keep **`scripts/setup_local_env.sh`** wholesale and filter-driven; do not duplicate its behavior with a second per-variable allowlist.
5. Keep the deployment scripts synchronized:
   - **`generate_deploy_env.sh`** must generate every required `prod|preview` input, keep runtime-only secrets in `.env.runtime.<environment>`, and idempotently preserve existing values while prompting only for missing inputs.
   - **`set_convex_deploy_env.sh`** must upload every Convex-owned value and set reusable project defaults for the selected deployment type.
   - **`set_vercel_deploy_env.sh`** must upload every Vercel-owned value to `production|preview`, marking actual secrets sensitive.
6. Never store deployment-specific `CONVEX_URL` or `CONVEX_SITE_URL` as project defaults. Production applies its explicit URLs to the current deployment; preview URLs are created per branch and injected by **`vercel_build.sh`**.
7. Keep browser-visible `VITE_*` values out of Convex and runtime/provider secrets out of Vercel. A `VITE_*` token is public configuration even when its name contains `TOKEN`.

After changes, exercise both `prod` and `preview` script paths and verify generated secrets remain split across their ownership boundaries.
