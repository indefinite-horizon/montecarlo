# Monte Carlo

Monte Carlo is a multi-model conversation workspace built around a branchable chat graph. Highlight part of an answer and follow it into a focused thread, or branch the current conversation with a fresh prompt. Every branch keeps its provenance and can use a different model provider without changing the stored chat format.

The repository starts from [`richardwu/convex-project-template`](https://github.com/richardwu/convex-project-template) at `37dcb99a44d38bbb5285fe71db1500fc4b0384f7` and reimplements the warm editorial design language of Socrates at `84f64c37a6f8777599b6c2de6580b12b1249058a`.

## What is implemented

- React/Vite SPA with project/chat creation, editable model and compatible-endpoint selection, message composition, selection-to-branch, prompt-only branching, and an interactive branch map.
- Electron 43 shell with a sandboxed renderer, navigation guards, denied browser permissions, narrow IPC, and an authenticated loopback runtime on a child-attested ephemeral port.
- Standalone desktop packaging with a pinned self-hosted Convex backend,
  offline function deployment, encrypted local service credentials, and
  signed/notarized one-click macOS updates.
- Provider-neutral local runtime with streamed events for Codex, Claude, OpenRouter, and Ollama.
- Codex uses the official local CLI app-server and the user's existing Codex/ChatGPT login. Credentials remain owned by Codex and never enter the renderer, Convex, or object storage.
- Claude uses the official local CLI and the user's existing Claude Pro/Max login. Credentials remain owned by Claude Code and never enter the renderer, Convex, or object storage.
- Multi-tenant Convex schema for workspaces, memberships, projects, chats, branches, message metadata, blob manifests, and model runs.
- Versioned portable domain envelopes and validators. No workspace transfer workflow is exposed yet.
- Local filesystem persistence is exposed today. The cloud R2 contract remains
  in the domain model for a future all-hosted workspace mode; provider
  credentials are deliberately outside that contract.

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
        └── local workspace: filesystem objects
```

Only local workspace creation is currently exposed. The target local product
uses self-hosted Convex, filesystem objects, and model execution on the user's
machine. Future cloud workspaces will use hosted Convex, private R2, and an
isolated managed sandbox as one indivisible hosted mode.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for invariants and data flow.

## Quickstart

Requirements: Bun 1.3.6, Node 22 or newer, and Chromium for browser tests.

```sh
cp .env.example .env.local
bun install
bun run dev
```

The web app defaults to `http://localhost:5173`. The local runner initializes an anonymous Convex development deployment and binds the model runtime only to a selected `127.0.0.1` port.

To develop the desktop app, use this instead of `bun run dev`; it starts the
complete Electron stack with renderer hot reload and automatic
main/preload/runtime restarts:

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

Local development uses one `.env.local`. The runtime loads the complete file,
while `scripts/filter_convex_env.sh` ensures only explicitly allowlisted values
are synchronized to Convex. Never put model-provider secrets in Convex function
arguments or documents.

## Workspace mode

Local message objects live under Electron's `app.getPath("userData")/workspaces/<public-id>/`. During development, metadata for all local workspaces shares the isolated anonymous Convex backend selected by `scripts/run_local.sh`; tenancy remains enforced by `workspaceId`. The Convex CLI's anonymous local deployment is development-only. Packaged Electron builds instead carry a checksum-pinned self-hosted Convex binary, CLI, function bundle, and license notice; they create encrypted instance credentials and durable state under Electron's application-data directory. No separate Convex install or external endpoint is required.

Cloud workspace creation is intentionally unavailable. It remains future work
and will ship only as an all-hosted boundary: hosted Convex metadata, private R2
objects, subscription enforcement, and isolated cloud Codex/Claude execution.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the planned credential
enrollment and runtime boundary.

The repository retains a versioned portable format and validator, but does not
expose local/cloud transfer. Convex `_id` values and absolute local paths are
never part of the portable format.

## Branch semantics

A chat owns a graph of branches. A branch points to at most one parent branch and records an anchor containing the source message, optional selected range/text, and optional prompt. The application remains the source of truth even when a native provider supports session forks.

Context for a new branch is snapshotted at creation and materialized deterministically from:

- a bounded recent window from the parent lineage;
- the complete source turn when available;
- the selected passage and provenance;
- the branch prompt.

This makes a branch reconstructible on Codex, Claude, OpenRouter, or Ollama without persisting provider-native transcripts.

## Environment files

- `.env.local`: local Convex, browser, and trusted-runtime configuration.
- `.worktreeinclude`: asks Conductor to copy the gitignored file into new workspaces.

Copy the checked-in example to `.env.local`. The local runner loads that file
for every local process, but only its allowlisted Convex-owned subset crosses
into the Convex backend. [`SECRETS.md`](SECRETS.md) is the canonical ownership
inventory. Packaged credentials should come from the desktop credential store.

Account-free mode is guarded twice: `ALLOW_LOCAL_ANONYMOUS_WORKSPACES=true` must be explicit and `SITE_URL` must resolve to a loopback origin. Cloud deployments must leave that flag unset and require Better Auth membership for every workspace operation.

## Reference docs

- [Architecture](docs/ARCHITECTURE.md)
- [Ontology](docs/ONTOLOGY.md)
- [Design](docs/DESIGN.md)
- [Security](docs/SECURITY.md)
- [Secrets and environment ownership](SECRETS.md)
- [Testing](docs/TESTING.md)
- [Future hosted deployment](docs/NEW_PROD_DEPLOY.md)
- [Desktop releases and OTA updates](docs/DESKTOP_RELEASE.md)

## Repository workflow

Conductor uses [.conductor/settings.toml](.conductor/settings.toml) for setup and run commands. New local worktrees receive isolated frontend/Convex/runtime ports. Agent rules under `.agents/rules/` enforce tenant authorization, indexed Convex reads, schema naming, uniqueness, secret isolation, i18n, and CI behavior.
