# Agent Guide

## Background

This repo is a template for a Convex + Vite + React application. It includes Better Auth, shadcn/ui, Effect, i18n, analytics outbox plumbing, Playwright, Vitest, GitHub Actions, and reusable agent rules/skills.

## Convention Enforcement

1. Local helpers and docs explain the intended path.
2. Custom lint in `scripts/lint-custom.ts` catches project-specific mistakes.
3. CI runs lint, typecheck, tests, build, codegen freshness, i18n validation, and Playwright projects.
4. Agent skills in `.agents/skills` preserve common review and recovery workflows.

## Hard Rules

- Do not commit secrets. Use `.env.local` locally and Vercel/Convex env vars in production.
- Do not bypass `scripts/run_local.sh` when validating the full local stack.
- Do not import analytics SDKs outside the approved adapter/outbox files.
- Do not hand-edit generated Convex or route tree files except to resolve codegen conflicts.
- Keep i18n keys in sync with `bun run validate:i18n`.

## Dev Environment

```sh
cp .env.example .env.local
bun install
bash scripts/run_local.sh
```

Local dev sign-in:

- `test@test.local`

Submitting the email in local development automatically opens the magic link.

## Planning And Review

Use `/babysit` after opening a PR. Use `/run-ci-local` to reproduce CI. Use `/verify-with-screenshot` when a UI change needs browser evidence.

## Testing

See [docs/TESTING.md](docs/TESTING.md). The short path is:

After completing any implementation work, consult [docs/TESTING.md](docs/TESTING.md) to determine whether new or updated tests are needed.

```sh
bun run lint
bun run typecheck
bun run test
bash scripts/prepare_e2e_env.sh .env.example .env.e2e
bun run test:e2e:core:ci
```

## Doc Map

- `README.md`: setup and feature overview.
- `docs/ONTOLOGY.md`: app-specific terminology and jargon.
- `docs/NEW_PROD_DEPLOY.md`: Vercel + Convex deployment.
- `docs/ANALYTICS.md`: event catalog and outbox model.
- `docs/TESTING.md`: unit, integration, and Playwright strategy.
- `docs/SECURITY.md`: security posture and checklist.
- `docs/DESIGN.md`: starter design guidance.
- `docs/LOCAL_SMOKE.md`: local and deployed smoke checks.
