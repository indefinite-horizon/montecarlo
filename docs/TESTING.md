# Testing

This is the source of truth for what to test and which local command to use.

## What To Test

Use the simplest test type that protects the behavior:

- Unit tests for pure logic, validators, builders, and small helpers.
- Integration tests for code that needs a realistic app boundary.
- Playwright tests for important user flows and regressions.

Do not test trivial implementation details. Do test business rules that would
be easy to break by accident.

## Commands

```sh
bun scripts/audit-critical.ts
bun run lint
bun run typecheck
bun run test
RUN_INTEGRATION_TESTS=1 bun run test
bun run validate:i18n
bun run build:web
```

Convex generated-code freshness:

```sh
bash scripts/codegen_anon.sh .env.example
git diff --exit-code convex/_generated
```

## E2E Projects

Playwright tests live in `tests/e2e/` and are split by filename:

- `*.spec.ts`: blocking deterministic core suite.
- `*.perf.spec.ts`: lightweight performance checks.
- `*.external.spec.ts`: opt-in real-network or provider checks.
- `*.nightly.external.spec.ts`: scheduled opt-in checks.

Commands:

```sh
bash scripts/prepare_e2e_env.sh .env.example .env.e2e
bun run test:e2e:core:ci
bun run test:e2e:perf:ci
bun run test:e2e:external:ci
```

## Local Stack Validation

Use `bash scripts/run_local.sh` when validating the full local stack. It
normalizes env, starts Convex, starts Vite, and prints the URL to open.

Do not bypass this script for full-stack validation. If you only need a narrow
unit/type/build check, use the smaller command directly.

## Playwright Guidelines

- Prefer role-based selectors and `data-testid`.
- Avoid selecting by CSS class or fragile DOM structure.
- Wait for user-visible state, not arbitrary timeouts.
- Keep each test focused on one meaningful flow.
- Use unique emails or IDs for tests that create users.
- Add screenshots when manually verifying UI changes.

## When To Add Persistent E2E

Add or update an E2E test for:

- significant user-facing flows
- regressions
- nuanced auth, routing, or permission behavior
- workflows that span multiple components

Do not add an E2E test if it cannot be made reliable in CI.
