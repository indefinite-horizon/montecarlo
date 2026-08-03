# Agent Guide

## Background

Monte Carlo is a local-first branchable conversation workspace. It uses a React/Vite SPA, Electron, a local Node/Bun model runtime, Convex, Better Auth, AI SDK 7, Tailwind/shadcn primitives, Effect, i18n, Vitest, and Playwright.

The application-owned chat DAG is always authoritative. Provider session IDs are optional accelerators and must never become required to reconstruct a conversation or move it between providers.

## Hard Rules

- Never commit secrets. Local model and object-store secrets belong in `.env.runtime.local` or the desktop credential boundary, never in Convex, analytics, renderer persistence, logs, or action arguments.
- Every public tenant Convex function must authorize active workspace membership. Do not accept a user/owner ID from clients.
- Every tenant-owned document carries `workspaceId`; tenant compound indexes begin with it and reads use those indexes.
- Keep stable public IDs and versioned envelopes at persistence boundaries. Never export Convex `_id` values or absolute local paths as portable identity.
- Keep branch persistence provider-neutral. Native Codex/Claude forks may optimize a run but do not define the graph.
- Do not enable Claude subscription authentication without written Anthropic approval. Direct Anthropic API-key access is supported.
- Do not read, copy, return, or persist Codex's auth cache. Let the official local SDK/CLI own and refresh it.
- Do not import provider SDKs into React or Convex query/mutation modules. Provider execution lives under `apps/runtime`.
- Do not hand-edit generated Convex or TanStack Router files except to resolve a documented codegen conflict.
- User-facing product copy uses locale keys. Run `bun run validate:i18n` after copy changes.

## Development

```sh
cp .env.example .env.local
cp .env.runtime.example .env.runtime.local
bun install
bun run dev
```

Use `bun run dev:desktop` for Electron. Use `.conductor/settings.toml` from Conductor workspaces; do not add a legacy `conductor.json`.

## Verification

Consult [docs/TESTING.md](docs/TESTING.md) for test selection. The standard path is:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bun run validate:i18n
```

Add focused coverage for branch graphs, context windows, authorization, portable imports, stream normalization, endpoint security, and provider cancellation when those areas change.

## Doc Map

- `README.md`: setup, feature status, and provider support.
- `docs/ARCHITECTURE.md`: runtime and persistence invariants.
- `docs/ONTOLOGY.md`: canonical product terminology.
- `docs/DESIGN.md`: visual and interaction rules.
- `docs/SECURITY.md`: trust boundaries and release checklist.
- `docs/TESTING.md`: unit, integration, desktop, and browser strategy.
- `docs/NEW_PROD_DEPLOY.md`: cloud and desktop release requirements.
