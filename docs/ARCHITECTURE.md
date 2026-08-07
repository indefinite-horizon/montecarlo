# Architecture

## Invariants

1. The application-owned chat DAG is the source of truth.
2. Provider credentials never enter portable workspace data.
3. Subscription harnesses and Ollama execute only on the user's device.
4. Convex owns authorization and portable metadata; object stores own large bodies and artifacts.
5. Every exported entity uses a stable public ID and explicit schema version.
6. A branch can be reconstructed without a provider-native session.

## Runtime boundary

The companion binds to loopback, validates origins, and requires a high-entropy bearer token outside explicit development mode. Electron creates a fresh token per launch and sends it through narrow IPC. The browser receives normalized events only:

```ts
type RuntimeEvent =
  | { type: "text-delta"; delta: string }
  | { type: "finish"; finishReason?: string; usage?: Usage }
  | { type: "error"; code: string; message: string };
```

Codex runs through the official SDK and its own credential cache. Claude runs through the official local CLI and the user's approved Pro or Max subscription login. OpenRouter and Ollama models use AI SDK 7. AI SDK's experimental Harness adapters are not the persistence abstraction: their current bridge implementations require a network sandbox, which is the wrong execution location for local subscription credentials.

## Chat execution

Every provider receives the same bounded, provider-neutral context and returns the same normalized event stream. Only the execution adapter inside the local companion changes:

```mermaid
sequenceDiagram
    actor User
    participant UI as React / Electron renderer
    participant Data as Convex + object store
    participant Runtime as Authenticated local companion
    participant Harness as Codex SDK / Claude CLI
    participant AISDK as AI SDK 7
    participant Endpoint as OpenRouter / local Ollama

    User->>UI: Send prompt with provider and model
    UI->>UI: Materialize bounded context from the chat DAG
    UI->>Data: Persist user message and create run
    Data-->>UI: Run ID
    UI->>Runtime: POST /v1/chat with context, provider, and model
    Runtime->>Runtime: Validate bearer, origin, request, and endpoint policy

    alt Codex or Claude subscription
        Runtime->>Harness: Start SDK thread or spawn CLI with full context
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

## Local and cloud modes

The development local mode uses Convex's anonymous local backend. Convex documents this as development-only. The current Electron package does not embed that backend; a distributable offline build must embed or supervise a reviewed self-hosted Convex release and include its license notices. Cloud metadata can use the hosted multi-tenant deployment, but public R2/managed-provider access remains gated on a Better Auth-bound capability gateway. Both modes retain the same domain and migration contracts.
