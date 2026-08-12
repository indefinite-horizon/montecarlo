# Architecture

## Invariants

1. The application-owned chat DAG is the source of truth.
2. Provider credentials never enter portable workspace data.
3. A workspace's persistence and model execution share one mode: entirely local or entirely cloud.
4. Convex owns authorization and portable metadata; object stores own large bodies and artifacts.
5. Every exported entity uses a stable public ID and explicit schema version.
6. A branch can be reconstructed without a provider-native session.

## Workspace modes

Monte Carlo exposes one workspace-level choice. The mode selects the complete
persistence and execution boundary; hybrid local/cloud workspaces are not part
of the product contract.

| Mode | Convex | Message bodies | Model execution |
| --- | --- | --- | --- |
| Local | Self-hosted on the user's device | Local filesystem | Local Codex and Claude harnesses, OpenRouter, or Ollama |
| Cloud | Hosted multi-tenant deployment | Private R2 bucket | Isolated managed sandbox such as Modal |

Local mode is the only mode currently exposed. Development uses the anonymous
local Convex backend. The distributable Electron build bundles and supervises
one checksum-pinned self-hosted Convex backend and its matching CLI, deploys the
packaged functions before loading the renderer, persists state under Electron's
application-data boundary, and includes the upstream license notice. Nothing
is downloaded to provision Convex on first launch.

Cloud mode is future work. Do not expose its workspace selector until hosted
Convex authorization, subscription entitlements, private R2 access, sandbox
execution, cancellation, metering, and deletion are implemented together.
Cloud workspaces must remain usable without the user's computer being online.

For future cloud Codex and Claude execution, the user explicitly generates a
revocable device or noninteractive access token for each provider. Monte Carlo
must never copy a local CLI credential cache. Tokens belong in an encrypted
cloud secret boundary, never Convex documents, R2 objects, action arguments,
renderer persistence, analytics, or logs, and are injected only into the
authorized workspace sandbox. Provider approval and token terms must be
confirmed before this flow ships.

The planned enrollment flows are Codex device authorization through
`codex login --device-auth` and Claude's noninteractive token flow through
`claude setup-token`, or their provider-approved successors. Enrollment must
happen against an isolated cloud credential boundary; it must not upload the
credential files from the user's device.

Local-to-cloud and cloud-to-local transitions are explicit verified transfers,
not a workspace setting toggle. Transfers preserve public IDs and versioned
envelopes while copying metadata between Convex deployments and message bodies
between the filesystem and R2.

## Packaged local data service

The build step downloads the reviewed Convex release named in
`apps/desktop/convex-bundle/backend-manifest.json`, verifies every archive and
license digest, and stages both macOS architectures plus an offline deployment
project under Electron resources. The release is never selected dynamically on
an end-user machine.

On launch, Electron:

1. decrypts or creates the instance, Better Auth, and blob-attestation secrets
   through the operating-system credential boundary;
2. starts the bundled backend on two OS-selected `127.0.0.1` ports with
   beaconing disabled and client logs redacted;
3. derives the admin key in memory, synchronizes the local-only backend
   environment, deploys the bundled functions, and runs the idempotent seed;
4. passes only the public loopback endpoints to the sandboxed renderer and only
   the attestation private key to the trusted model runtime.

SQLite, Convex object storage, deployment state, and one rollback snapshot live
under `app.getPath("userData")/convex`. The admin key is never persisted or
exposed to the renderer. Function updates snapshot the stopped database before
deployment and restore it after an interrupted or failed push. A change to the
Convex binary or data-format version is refused unless a separately implemented
and tested migration path accompanies it; changing a version number in a
manifest is not a migration.

This makes application metadata and Ollama-backed execution capable of working
without a network after installation. Codex, Claude, and OpenRouter still need
their official local tooling/authentication and whatever network their provider
requires.

## Desktop updates

The desktop update identity is the stable tuple of application ID, executable
name, Apple signing team, public update repository, channel, and data-layout
contract. A successful `main` CI run builds a universal macOS DMG and ZIP,
signs and notarizes the app and every bundled executable, uploads an invisible
draft, verifies signatures, notarization, architectures, feed hashes, and
compatibility metadata, and only then publishes the release.

Electron downloads an applicable update in the background. Only the
`update-downloaded` event reaches the renderer; once per app session it shows a
persistent dismissible toast with **See changelog** and **Update**. Update first
stops the model runtime and Convex cleanly, then calls the updater's atomic
install-and-relaunch operation.

The compatibility gate tests direct jumps from the previous published
contract, keeps the feed and application identity immutable, requires versions
to increase, and blocks an unplanned local data-layout or signing-team change.
This is a fail-closed compatibility policy, not an unconditional guarantee
against corrupt disks or upstream defects. A user must manually install the
first signed updater-capable DMG; software released before it contained an
updater cannot be upgraded remotely. See [DESKTOP_RELEASE.md](DESKTOP_RELEASE.md)
for the release runbook.

## Local runtime boundary

The companion binds to loopback, validates origins, and requires a high-entropy bearer token outside explicit development mode. Electron creates a fresh token per launch and sends it through narrow IPC. The browser receives normalized events only:

```ts
type RuntimeEvent =
  | { type: "text-delta"; delta: string }
  | { type: "finish"; finishReason?: string; usage?: Usage }
  | { type: "error"; code: string; message: string };
```

Codex runs through the official CLI app-server and its own credential cache. Its token-level app-server notifications are normalized into the same runtime event stream as every other provider. Claude runs through the official local CLI and the user's approved Pro or Max subscription login. OpenRouter and Ollama models use AI SDK 7. AI SDK's experimental Harness adapters are not the persistence abstraction.

## Chat execution

Every provider receives the same bounded, provider-neutral context and returns the same normalized event stream. Only the execution adapter inside the local companion changes:

```mermaid
sequenceDiagram
    actor User
    participant UI as React / Electron renderer
    participant Data as Convex + object store
    participant Runtime as Authenticated local companion
    participant Harness as Codex app-server / Claude CLI
    participant AISDK as AI SDK 7
    participant Endpoint as OpenRouter / local Ollama

    User->>UI: Send prompt with provider and model
    UI->>UI: Materialize bounded context from the chat DAG
    UI->>Data: Persist user message and create run
    Data-->>UI: Run ID
    UI->>Runtime: POST /v1/chat with context, provider, and model
    Runtime->>Runtime: Validate bearer, origin, request, and endpoint policy

    alt Codex or Claude subscription
        Runtime->>Harness: Start app-server thread or spawn CLI with full context
        Note over Harness: Official tooling owns login and credential access
        Harness-->>Runtime: Native streamed events and optional session/thread ID
    else OpenRouter or Ollama model
        Runtime->>AISDK: streamText with messages and abort signal
        AISDK->>Endpoint: OpenAI-compatible streaming request
        Note over Runtime,Endpoint: OpenRouter keys stay in the runtime boundary; Ollama is restricted to loopback
        Endpoint-->>AISDK: Provider stream
        AISDK-->>Runtime: AI SDK stream parts
    end

    loop Until finish, error, or cancellation
        Runtime-->>UI: Normalized SSE events (text, reasoning, usage, status)
        UI-->>User: Render incremental assistant output
    end
    UI->>Data: Persist assistant message and complete run
    Note over UI,Data: The app-owned DAG remains authoritative; provider session IDs are optional and discardable
```

Streaming text stays transient in the initiating renderer and is persisted once, as the final message body. Convex live queries remain the source of truth for durable metadata, but are not an intermediate token journal: that would duplicate the direct SSE path and place plaintext message bodies outside the object-storage boundary.

## Chat graph

```text
workspace
  └─ project? (optional)
       └─ chat
            └─ branch (root)
                 ├─ message metadata → blob
                 ├─ branch → selected passage
                 │    └─ messages → blobs
                 └─ branch → prompt
                      └─ messages → blobs
```

Branches form a rooted DAG with a single parent per node. A branch anchor records source message, selection offsets/text, prompt, and an immutable bounded set of ancestor message IDs. Messages belong to the branch where they were created. A transcript view includes only that snapshot plus messages created on the active branch, so later parent turns cannot leak into an existing child.

Selection offsets and quotes that overlap the Convex preview are checked against that preview. A selection wholly inside an object-stored tail can only be checked for valid bounds until the runtime hydrates the body. Selection text is therefore user-authored branch focus, not an authorization or content-attestation boundary.

## Context materialization

Context is deterministic and bounded by bytes and turns. The algorithm walks the active lineage backwards, preserves whole recent turns where possible, guarantees the anchor source turn when within configured limits, adds a clearly delimited selected passage, and appends the branch prompt. Truncation occurs at UTF-8-safe boundaries and is reported in metadata.

Provider-native session IDs live on runtime-session records and can be discarded. Codex `thread/fork` or a future approved Claude session fork may improve continuity but cannot change branch semantics.

## Storage

Convex rows keep searchable metadata and small previews. Each large body is a versioned JSON envelope stored as an object:

```text
v1/workspaces/<workspace-public-id>/objects/<hash-prefix>/<sha256>
```

Blob manifests store backend, portable key, SHA-256, byte length, media type, envelope version, and lifecycle state. Local backends resolve the portable key under the workspace's `objects/` directory. Cloud backends resolve it in a private R2 bucket. Absolute paths and signed URLs are never persisted.

## Portability and migrations

Exports contain `manifest.json`, newline-delimited entity tables, and objects. Imports use expand → dual read/write → batched idempotent backfill → contract. Import first creates a staging workspace, verifies every object hash and reference, then atomically marks the workspace active. Importing the same public IDs is idempotent.

## Workspace authorization

Better Auth owns credentials and sessions. The app-owned `users` row gives Convex functions a stable user ID. Every public function:

1. resolves the authenticated user;
2. loads membership through a `workspaceId`-first index;
3. verifies active status and the required role;
4. performs every subsequent tenant read through a `workspaceId`-first index.

Internal calls carry explicit authorized actor/workspace context. They do not turn a client-provided user ID into authority.
