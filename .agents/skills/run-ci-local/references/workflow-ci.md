# workflow-ci.md - local mirror of `.github/workflows/ci.yml`

Authoritative command map for Agent A. Each job in `ci.yml` maps to a local command. Run them in the groupings below.

## Preflight

Run once at the start - every downstream job assumes deps are installed.

```bash
bun install
```

Install Playwright's Chromium dependencies before e2e jobs if they are not already present:

```bash
bunx playwright install --with-deps chromium
```

## Job -> command map

### Fast jobs

| CI job | Local command | Notes |
|---|---|---|
| `audit` | `bun scripts/audit-critical.ts` | Mirrors the template's critical audit wrapper. |
| `lint` | `bun run lint` | Biome plus custom lint rules. |
| `typecheck` | `bun run typecheck` | Runs web, desktop, and Convex TypeScript checks. |
| `test` | `bun run test` | Vitest unit tests. |
| `integration-test` | `RUN_INTEGRATION_TESTS=1 bun run test` | Mirrors the second test step in the `test` job. |
| `build` | `bun run build:web` | Web build only, matching CI. |
| `convex-codegen` | `bash scripts/codegen_anon.sh .env.example && git diff --exit-code convex/_generated` | Fail if codegen produces a diff. |
| `validate-i18n` | `bun run validate:i18n` | Locale key validation. |

Run these in parallel only when the host has enough RAM and the output remains understandable. Keep `build`, `test`, and `integration-test` separate because their output is usually the most verbose.

### E2E jobs

Prepare the CI e2e env once before running the e2e project split:

```bash
bash scripts/prepare_e2e_env.sh .env.example .env.e2e
```

| CI job | Local command |
|---|---|
| `e2e-core` | `bun run test:e2e:core:ci` |
| `e2e-perf` | `PLAYWRIGHT_WORKERS=2 bun run test:e2e:perf:ci` |
| `e2e-external` | `PLAYWRIGHT_WORKERS=2 bun run test:e2e:external:ci` |

Run e2e jobs **sequentially**. They share local app, Convex, and browser resources and are easier to debug when their logs are not interleaved.

For manual browser verification outside CI parity, use `bash scripts/run_local.sh --command "<command>"` so the full local stack is started through the approved helper.

## Reporting shape

Return to the orchestrator exactly this JSON (one object, no prose):

```json
{
  "jobs": [
    { "name": "audit",            "status": "pass", "duration_s": 4,   "tail": "..." },
    { "name": "lint",             "status": "pass", "duration_s": 12,  "tail": "..." },
    { "name": "typecheck",        "status": "fail", "duration_s": 48,  "tail": "..." },
    { "name": "test",             "status": "pass", "duration_s": 73,  "tail": "..." },
    { "name": "integration-test", "status": "pass", "duration_s": 90,  "tail": "..." },
    { "name": "build",            "status": "pass", "duration_s": 92,  "tail": "..." },
    { "name": "convex-codegen",   "status": "pass", "duration_s": 18,  "tail": "..." },
    { "name": "validate-i18n",    "status": "pass", "duration_s": 3,   "tail": "..." },
    { "name": "e2e-core",         "status": "pass", "duration_s": 420, "tail": "..." },
    { "name": "e2e-perf",         "status": "pass", "duration_s": 180, "tail": "..." },
    { "name": "e2e-external",     "status": "pass", "duration_s": 210, "tail": "..." }
  ]
}
```

- `status`: `"pass"` (exit 0) or `"fail"` (non-zero).
- `tail`: last ~40 lines of combined stdout/stderr for the job. Trim ANSI color codes if easy; leave them if trimming is flaky.
- Do not omit jobs. If something was genuinely skipped, include it with `"status": "skipped"` and explain in `tail`.

## Rules

- **Observation only.** Do not edit files. Do not retry failing jobs. Do not invoke other skills.
- **Do not scope e2e to a diff.** Run the full suite per project, matching CI exactly.
- **Stop on catastrophic failure.** If `bun install` itself fails, return `{ "jobs": [], "fatal": "<message>" }` so the orchestrator can abort.
