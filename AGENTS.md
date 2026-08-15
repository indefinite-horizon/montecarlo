# Agent Guide

## Background

Monte Carlo is a branchable conversation workspace. It uses a React/Vite SPA, Electron, a local Node/Bun model runtime, Convex, Better Auth, AI SDK 7, Tailwind/shadcn primitives, Effect, i18n, Vitest, and Playwright.

The application-owned chat DAG is always authoritative. Provider session IDs are optional accelerators and must never become required to reconstruct a conversation or move it between providers.

## Hard Rules

- Never commit secrets. Local operator configuration lives in `.env.local`;
  local model secrets must remain browser-invisible and are excluded from
  Convex by `scripts/filter_convex_env.sh`. Prefer the desktop credential
  boundary when available. Never put provider secrets in Convex, analytics,
  renderer persistence, logs, or action arguments.
- Keep `.env.example` focused on values an operator must supply or intentionally choose. Group
  currently supported local credentials by ownership in this order: cross-boundary
  Convex-and-runtime credentials, Convex-only secrets, and runtime-only secrets.
  Do not add future cloud, hosted deployment, managed-provider, or R2 variables
  until cloud mode ships. List each assignment once, keep non-secret
  configuration in separate owner-specific sections, and mark browser-visible
  values as public. Do not duplicate tuning knobs or values that already have
  sane runtime defaults; keep those defaults in config.
- Treat `SECRETS.md` as the canonical secret and environment-ownership inventory. Whenever an
  environment variable, credential, token, or runtime ownership boundary is added, renamed,
  removed, or changed, review and update `SECRETS.md` and `.env.example` in the same change.
  Secret-bearing and operator-supplied values must use the same ownership model in both files;
  non-secret tuning knobs with runtime defaults remain documented through their config modules
  rather than duplicated as active `.env.example` assignments. Never place real values, token
  fragments, hashes, credential lengths, or screenshots in either file.
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
- Before changing UI typography, colors, component choice, or component styling,
  consult `docs/DESIGN.md`. Follow its shared typography scale and button
  hierarchy, and extend shared primitives before introducing repeated one-off styles.

## Planning for Cloud

These are hard constraints even while only local mode is implemented. See
[`MIGRATION.md`](MIGRATION.md) for the workspace-transfer contract, gaps,
implementation phases, and release gates.

- Every public tenant Convex function authorizes active workspace membership;
  never accept a user or owner ID from a client as authority.
- Every tenant-owned document carries `workspaceId`; workspace-bounded compound
  indexes and reads begin with it. Limit global discovery indexes to documented
  authorization entry points such as membership lookup, and authorize before
  reading tenant data.
- Keep stable public IDs and versioned envelopes at persistence boundaries.
  Never export Convex `_id` values or absolute local paths as portable identity.
- Keep the application-owned chat DAG provider-neutral and reconstructable
  without provider sessions. Native Codex or Claude forks may optimize a run
  but never define the graph.
- Implement only local workspace mode for now: local self-hosted Convex, local
  filesystem objects, and model execution on the user's device. Do not expose a
  cloud selector or hybrid local/cloud workspace.
- Ship cloud mode only as one complete hosted boundary: hosted multi-tenant
  Convex, private R2, Better Auth authorization, subscription enforcement,
  isolated model execution, provider enrollment, metering, cancellation, and
  deletion.
- Treat local-to-cloud and cloud-to-local changes as explicit, staged, verified,
  idempotent transfers—not a `storageMode` toggle or raw database copy.
- Transfer only application-owned portable state. Re-establish cloud identity,
  membership, provider authorization, and secrets inside their target trust
  boundaries; never upload local credential caches.
- Keep portable versions independent of Convex `_id` values, the embedded
  SQLite/data-format version, and the current table layout. Preserve import
  fixtures and deterministic migrators for every supported portable version.

## Development

```sh
cp .env.example .env.local
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

Whenever adding E2E coverage for a new flow, cover the currently implemented
local workspace mode. When cloud mode is implemented, restore equivalent E2E
coverage for every flow whose persistence or execution boundary differs.

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
- `MIGRATION.md`: future local/cloud workspace-transfer contract and implementation plan.
- `SECRETS.md`: canonical secret-bearing environment and deployment ownership inventory.
- `docs/ARCHITECTURE.md`: runtime and persistence invariants.
- `docs/ONTOLOGY.md`: canonical product terminology.
- `docs/DESIGN.md`: visual and interaction rules.
- `docs/SECURITY.md`: trust boundaries and release checklist.
- `docs/TESTING.md`: unit, integration, desktop, and browser strategy.
- `docs/DESKTOP_RELEASE.md`: standalone macOS packaging and OTA release gates.
- `docs/NEW_PROD_DEPLOY.md`: future hosted-cloud deployment requirements.
