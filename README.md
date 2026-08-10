# Monte Carlo

Monte Carlo is a multi-model conversation workspace built around a branchable chat graph. Highlight part of an answer and follow it into a focused thread, or branch the current conversation with a fresh prompt. Every branch keeps its provenance and can use a different model provider without changing the stored chat format.

The repository starts from [`richardwu/convex-project-template`](https://github.com/richardwu/convex-project-template) at `37dcb99a44d38bbb5285fe71db1500fc4b0384f7` and reimplements the warm editorial design language of Socrates at `84f64c37a6f8777599b6c2de6580b12b1249058a`.

## What is implemented

- React/Vite SPA with project/chat creation, editable model and compatible-endpoint selection, message composition, selection-to-branch, prompt-only branching, and an interactive branch map.
- Electron 43 shell with a sandboxed renderer, navigation guards, denied browser permissions, narrow IPC, and an authenticated loopback runtime on a child-attested ephemeral port.
- Provider-neutral local runtime with streamed events for Codex, Claude, OpenRouter, and Ollama.
- Codex uses the official local CLI app-server and the user's existing Codex/ChatGPT login. Credentials remain owned by Codex and never enter the renderer, Convex, or object storage.
- Claude uses the official local CLI and the user's existing Claude Pro/Max login. Credentials remain owned by Claude Code and never enter the renderer, Convex, or object storage.
- Multi-tenant Convex schema for workspaces, memberships, projects, chats, branches, message metadata, blob manifests, and model runs.
- Versioned portable domain envelopes and validators. No workspace transfer workflow is exposed yet.
- Local filesystem and cloud R2 are routed per workspace behind the same blob-manifest contract; provider credentials are deliberately outside that contract.

## Architecture

```text
React SPA / Electron renderer
        │
        ├── Convex ── workspace membership, projects, chat DAG,
        │             message/blob metadata and runs
        │
        └── authenticated loopback runtime (Electron or companion)
                  ├── Codex app-server ── existing local ChatGPT-plan login
                  ├── Claude CLI ── existing local Pro/Max login
                  ├── AI SDK 7 ─── OpenRouter
                  └── AI SDK 7 ─── Ollama's OpenAI-compatible endpoint

Message bodies / tool artifacts
        ├── local workspace: filesystem objects
        └── cloud workspace: R2 objects
```

Convex is the portable control plane, not the model-execution environment. Subscription harnesses and Ollama always run on the user's machine. The browser SPA connects to the companion runtime; the Electron app starts it automatically.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for invariants and data flow.

## Quickstart

Requirements: Bun 1.3.6, Node 22 or newer, and Chromium for browser tests.

```sh
cp .env.example .env.local
cp .env.example .env.runtime.local
bun install
bun run dev
```

The web app defaults to `http://localhost:5173`. The local runner initializes an anonymous Convex development deployment and binds the model runtime only to a selected `127.0.0.1` port.

Start the desktop shell after the web stack is healthy:

```sh
bun run dev:desktop
```

Useful checks:

```sh
bun run lint
bun run typecheck
bun run test
bun run build:web
bun run build:runtime
```

## Provider setup

| Provider | Supported credential | Execution location | Notes |
| --- | --- | --- | --- |
| Codex | Existing `codex login` / ChatGPT-plan session | Local only | Requires the official Codex CLI on `PATH` (or `CODEX_PATH`). `codex login --device-auth` is available through the companion. The app never reads `~/.codex/auth.json`. |
| Ollama | No credential by default | Local only | Defaults to `http://127.0.0.1:11434/v1`; arbitrary insecure remote endpoints are rejected. |
| OpenRouter | User API key or administrator-provisioned runtime key | Local companion | User keys stay in the local credential boundary; settings or `OPENROUTER_BASE_URL` selects an HTTPS-compatible endpoint, and managed keys are never forwarded to request-selected endpoints. |
| Claude | Existing Claude Code Pro/Max session | Local only | Requires the official Claude CLI on `PATH` (or `CLAUDE_PATH`). Monte Carlo invokes the CLI but never reads its credential store. |

Runtime-only secrets belong in `.env.runtime.local`, not `.env.local`. The latter is synchronized to the local Convex backend by the development scripts. Never put model-provider secrets in Convex function arguments or documents.

## Workspace modes

Local message objects live under Electron's `app.getPath("userData")/workspaces/<public-id>/`. During development, metadata for all local workspaces shares the isolated anonymous Convex backend selected by `scripts/run_local.sh`; tenancy remains enforced by `workspaceId`. The Convex CLI's anonymous local deployment is development-only. The packaged Electron artifact currently requires an external Convex endpoint; shipping a standalone offline metadata backend still requires a reviewed self-hosted Convex distribution and its current license notices.

Cloud workspace metadata uses the shared multi-tenant Convex deployment and R2-compatible manifests. The companion can route R2 when trusted credentials are configured, but a public multi-tenant storage/provider gateway is not enabled yet; it requires short-lived Better Auth-bound capabilities rather than a browser-visible shared bearer. Every tenant-owned record carries `workspaceId`; public Convex functions verify active membership. Provider credentials never sync with the workspace.

The repository retains a versioned portable format and validator, but does not expose local/cloud transfer. A workspace's storage mode is fixed when it is created. Convex `_id` values and absolute local paths are never part of the portable format.

## Branch semantics

A chat owns a graph of branches. A branch points to at most one parent branch and records an anchor containing the source message, optional selected range/text, and optional prompt. The application remains the source of truth even when a native provider supports session forks.

Context for a new branch is snapshotted at creation and materialized deterministically from:

- a bounded recent window from the parent lineage;
- the complete source turn when available;
- the selected passage and provenance;
- the branch prompt.

This makes a branch reconstructible on Codex, Claude, OpenRouter, or Ollama without persisting provider-native transcripts.

## Environment files

- `.env.local`: Convex, Better Auth, browser build, and non-secret development settings.
- `.env.runtime.local`: model-provider keys, loopback token, R2 credentials, and local runtime settings.
- `.worktreeinclude`: asks Conductor to copy both gitignored files into new workspaces.

The single checked-in example groups operator-supplied values by owner. Copy it to both local files, then set Convex/web values only in `.env.local` and runtime values only in `.env.runtime.local`. [`SECRETS.md`](SECRETS.md) is the canonical ownership inventory. Production secrets should come from the desktop credential store or the runtime's deployment environment.

Account-free mode is guarded twice: `ALLOW_LOCAL_ANONYMOUS_WORKSPACES=true` must be explicit and `SITE_URL` must resolve to a loopback origin. Cloud deployments must leave that flag unset and require Better Auth membership for every workspace operation.

## Reference docs

- [Architecture](docs/ARCHITECTURE.md)
- [Ontology](docs/ONTOLOGY.md)
- [Design](docs/DESIGN.md)
- [Security](docs/SECURITY.md)
- [Secrets and environment ownership](SECRETS.md)
- [Testing](docs/TESTING.md)
- [Deployment](docs/NEW_PROD_DEPLOY.md)

## Repository workflow

Conductor uses [.conductor/settings.toml](.conductor/settings.toml) for setup and run commands. New local worktrees receive isolated frontend/Convex/runtime ports. Agent rules under `.agents/rules/` enforce tenant authorization, indexed Convex reads, schema naming, uniqueness, secret isolation, i18n, and CI behavior.
