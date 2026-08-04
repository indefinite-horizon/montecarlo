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
bun run build:runtime
bun run --filter './apps/desktop' build:dir
```

Convex generated-code freshness:

```sh
bash scripts/codegen_anon.sh .env.example
git diff --exit-code convex/_generated
```

## E2E Projects

Playwright tests live in `tests/e2e/` and are split by filename:

- `*.spec.ts`: blocking deterministic core suite.
- `desktop/*.spec.ts`: opt-in Electron shell suite.
- `*.perf.spec.ts`: lightweight performance checks.
- `*.external.spec.ts`: opt-in real-network or provider checks.
- `*.nightly.external.spec.ts`: scheduled opt-in checks.

Commands:

```sh
bash scripts/prepare_e2e_env.sh .env.example .env.e2e
bun run test:e2e:core:ci
bun run test:e2e:desktop
bun run test:e2e:perf:ci
bun run test:e2e:external:ci
```

The core project starts both the ordinary local build and an auth-required
build. Its loopback runtime fixture signs and retains message envelopes in
memory, so provider streaming and durable blob round trips do not use external
model networks. External provider cases run only when
`RUN_EXTERNAL_PROVIDER_TESTS=true` and their provider-specific flag is set.

## Local Stack Validation

Use `bash scripts/run_local.sh` when validating the full local stack. It
normalizes env, starts Convex, Vite, and the authenticated model companion, and
prints every selected URL. Conductor workspaces allocate an isolated companion
port from the workspace's port range.

Do not bypass this script for full-stack validation. If you only need a narrow
unit/type/build check, use the smaller command directly.

## Playwright Guidelines

- Prefer role-based selectors and `data-testid`.
- Avoid selecting by CSS class or fragile DOM structure.
- Wait for user-visible state, not arbitrary timeouts.
- Keep each test focused on one meaningful flow.
- Use unique emails or IDs for tests that create users.
- Add screenshots when manually verifying UI changes.

## Major PR And Feature Planning

For every major PR or feature plan, identify the core user flows that the
change introduces or materially alters and decide whether they need persistent
E2E coverage. Before adding tests, review the existing E2E suite and design the
combined coverage to be mutually exclusive and collectively exhaustive (MECE):
avoid redundant scenarios while covering every important distinct flow. Modify
or consolidate existing tests when needed to keep the overall suite MECE.

## When To Add Persistent E2E

Add or update an E2E test for:

- significant user-facing flows
- regressions
- nuanced auth, routing, or permission behavior
- workflows that span multiple components

Do not add an E2E test if it cannot be made reliable in CI.

## Domain And Runtime Coverage

The root Vitest suite protects deterministic branch traversal, bounded context
materialization, and portable-envelope graph/hash validation. The runtime owns
its own focused suite for origin/Host/bearer checks, strict request validation,
stream normalization, cancellation, filesystem confinement, and mocked provider
adapters. Provider-network tests are external tests and must be opt-in.

Desktop verification should include `node --check`, an unsigned directory
build on the target platform, custom-protocol navigation, encrypted key save,
runtime restart, and a renderer check confirming no key readback API exists.
