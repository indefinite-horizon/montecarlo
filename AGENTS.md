# Agent Guide

## Background

Monte Carlo is a branchable conversation workspace. It uses a React/Vite SPA, Electron, a local Node/Bun model runtime, Convex, Better Auth, AI SDK 7, Tailwind/shadcn primitives, Effect, i18n, Vitest, and Playwright.

The application-owned chat DAG is always authoritative. Provider session IDs are optional accelerators and must never become required to reconstruct a conversation or move it between providers.

## Hard Rules

- Never commit secrets. Local model and object-store secrets belong in `.env.runtime.local` or the desktop credential boundary, never in Convex, analytics, renderer persistence, logs, or action arguments.
- Keep `.env.example` focused on values an operator must supply or intentionally choose. Group
  credentials by ownership in this order: cross-boundary Convex-and-runtime credentials,
  Convex-only secrets, runtime-only secrets, and deployment-only secrets. List each assignment
  once, keep non-secret configuration in separate owner-specific sections, and mark
  browser-visible values as public. Do not duplicate tuning knobs or values that already have sane
  runtime defaults; keep those defaults in config.
- Treat `SECRETS.md` as the canonical secret and environment-ownership inventory. Whenever an
  environment variable, credential, token, or runtime ownership boundary is added, renamed,
  removed, or changed, review and update `SECRETS.md` and `.env.example` in the same change.
  Secret-bearing and operator-supplied values must use the same ownership model in both files;
  non-secret tuning knobs with runtime defaults remain documented through their config modules
  rather than duplicated as active `.env.example` assignments. Never place real values, token
  fragments, hashes, credential lengths, or screenshots in either file.
- Every public tenant Convex function must authorize active workspace membership. Do not accept a user/owner ID from clients.
- Every tenant-owned document carries `workspaceId`; tenant compound indexes begin with it and reads use those indexes.
- Keep stable public IDs and versioned envelopes at persistence boundaries. Never export Convex `_id` values or absolute local paths as portable identity.
- Keep branch persistence provider-neutral. Native Codex/Claude forks may optimize a run but do not define the graph.
- Use TanStack Router for in-app navigation. Push fully specified paths, including every state-bearing
  query parameter, so browser back and forward restore the complete workspace, chat, branch, and view.
- Keep in-app Back and Forward controls on an application-owned route stack. Never delegate those
  controls to browser history, where external referrers and authentication redirects can appear.
- Claude subscription authentication has written Anthropic approval. Use the official
  local Claude CLI login and never read or persist its credential cache.
- Do not read, copy, return, or persist Codex's auth cache. Let the official local SDK/CLI own and refresh it.
- Do not import provider SDKs into React or Convex query/mutation modules. Provider execution lives under `apps/runtime`.
- Do not hand-edit generated Convex or TanStack Router files except to resolve a documented codegen conflict.
- User-facing product copy uses locale keys. Run `bun run validate:i18n` after copy changes.
- UI descriptions: do not add subtitles, helper text, or descriptive copy beneath headings, labels, cards, or settings by default. Prefer one concise, self-explanatory heading or label. Only add supporting copy when the user explicitly asks for it or when it is necessary to prevent misunderstanding or error, and never use it to restate the heading.
- Use toasts for ephemeral success, error, and completion feedback. Reserve inline notices for state that must remain visible or requires an in-context action.
- Treat keyboard shortcuts as first-class UX: show platform-correct shortcut hints, preserve accessible click or menu equivalents, and add broadly useful actions to the Cmd/Ctrl+K palette unless they are context-specific or unsafe to invoke globally.
- Icon-only action buttons must have an accessible name and a hover/focus tooltip. Show the shortcut at the right side of the tooltip when one exists.
- Co-located buttons, segmented controls, and toggles must use the same visible height and hit-target size unless a documented hierarchy requires otherwise.

## Development

```sh
cp .env.example .env.local
cp .env.example .env.runtime.local
bun install
bun run dev
```

Use `bun run dev:desktop` for Electron. Use `.conductor/settings.toml` from Conductor workspaces; do not add a legacy `conductor.json`.

## Verification

Consult [docs/TESTING.md](docs/TESTING.md) for test selection. The standard path is:

For every major PR or feature implementation on the current working branch,
consult [docs/TESTING.md](docs/TESTING.md) during planning and again after
implementation. Review the existing E2E suite, identify core user flows that
need coverage, and add, update, consolidate, or remove tests as needed to keep
the suite MECE.

Whenever adding E2E coverage for a new flow, determine whether the flow touches
persistence whose behavior or storage boundary differs between local-storage
and cloud-storage workspaces. If it does, add equivalent E2E coverage for both
workspace modes.

After completing any other implementation work, consult
[docs/TESTING.md](docs/TESTING.md) to determine whether new or updated tests are
needed.

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
- `SECRETS.md`: canonical secret-bearing environment and deployment ownership inventory.
- `docs/ARCHITECTURE.md`: runtime and persistence invariants.
- `docs/ONTOLOGY.md`: canonical product terminology.
- `docs/DESIGN.md`: visual and interaction rules.
- `docs/SECURITY.md`: trust boundaries and release checklist.
- `docs/TESTING.md`: unit, integration, desktop, and browser strategy.
- `docs/NEW_PROD_DEPLOY.md`: cloud and desktop release requirements.
