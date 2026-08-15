# Workspace Migration

This document is the implementation plan and compatibility contract for moving
a Monte Carlo workspace between local and cloud modes. It covers logical
workspace transfer, not ordinary Convex schema migrations or disaster recovery
of an entire deployment.

Cloud mode and workspace transfer are not implemented. Local mode remains the
only product mode until the complete hosted boundary described in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is ready.

## Decision

A local-to-cloud migration is a verified application-level export and import.
It is not:

- a `storageMode` update on an existing workspace;
- a copy of the embedded SQLite file;
- a table-by-table append of raw Convex documents; or
- an upload of local provider credential stores.

The metadata conversion should be routine because the schema is workspace
scoped and entities have stable public IDs. The complete transfer is still a
cross-system workflow: Convex metadata must be remapped into a populated hosted
deployment, object bodies must move from the filesystem to private R2, cloud
identity must replace local anonymous identity, and activation must remain safe
across retries and partial failures.

## Migration Types

Keep these operations separate:

| Operation | Mechanism | Scope |
| --- | --- | --- |
| Convex schema or data-shape change | Widen, migrate in batches, then narrow | One deployment |
| Whole-deployment disaster recovery | Convex backup/export and restore | Every table in an empty or replaceable deployment |
| Local/cloud workspace transfer | Monte Carlo portable export/import | One workspace in a populated multi-tenant deployment |
| Embedded Convex data-format upgrade | Pinned, tested desktop migration with rollback snapshot | The local application data service |

Convex can export a local deployment and preserve `_id` references when a
backup is restored, but restoring a backup is deployment-oriented and may
replace existing table data. It is not the merge primitive for one tenant in a
shared cloud deployment. See Convex's [data import](https://docs.convex.dev/database/import-export/import)
and [backup and restore](https://docs.convex.dev/database/backup-restore)
documentation.

Never read or modify `convex.sqlite3` directly. Logical APIs and versioned
portable data are the compatibility boundary; the SQLite and hosted Convex
storage formats are implementation details.

## Existing Foundations

The repository already reduces the future migration surface:

- The application-owned chat DAG is authoritative. Provider sessions are
  optional accelerators, so a conversation can continue after transfer without
  a native session ID.
- Workspaces are tenant roots. Tenant documents carry `workspaceId`, and each
  tenant table provides a workspace-first export path, making a bounded,
  paginated export possible.
- Core persisted entities have stable `publicId` values. Portable references
  can be resolved to newly allocated Convex `_id` values in the target.
- The domain package defines a versioned, storage-neutral workspace envelope
  and validates structure, duplicate IDs, graph references, selections, and
  blob digests.
- Message and artifact objects use content-addressed, relative keys under
  `v1/workspaces/<workspace-public-id>/objects/...`; no absolute path or signed
  URL is portable.
- Convex stores searchable metadata and previews, while the runtime owns large
  bodies. Filesystem and R2 adapters share the same object-manifest contract.
- Blob reservation is idempotent by workspace public ID and digest and rejects
  conflicting content.
- The planned transfer acceptance cases already cover both directions,
  repeated import, corrupt input, and continuation without provider sessions.

These invariants must be preserved by routine feature and schema work. Do not
introduce a persistence boundary that requires a local absolute path, a Convex
`_id`, a provider session, or a credential to reconstruct portable state.

## Current Gaps

The foundations are contracts, not a working transfer path:

- There is no adapter from the current Convex schema and object envelopes to
  the portable workspace format, and no importer from that format.
- The current workspace creation mutation always creates local workspaces.
- The shared cloud R2/runtime gateway, subscription enforcement, managed
  execution, metering, cancellation, and deletion boundary do not exist yet.
- The transfer Playwright cases in
  [`tests/e2e/portability/transfer.spec.ts`](tests/e2e/portability/transfer.spec.ts)
  are intentionally marked `fixme`.
- There is no export write barrier or snapshot/checkpoint protocol.
- There is no durable transfer job, staging lifecycle, activation marker,
  retry cursor, or cleanup process.
- There are no pure migrators for older portable envelope/schema versions.
- The persisted branch stores an immutable `contextMessageIds` snapshot, but
  the current portable `ChatBranch` shape does not encode that snapshot. Before
  claiming lossless transfer, extend or otherwise prove the portable contract
  preserves the exact ancestor-message set so later parent turns cannot leak
  into an imported branch.
- The portable format intentionally differs from storage rows—for example,
  portable messages contain normalized parts while Convex stores an object
  reference and preview—but the required normalization policy is not yet
  implemented or tested end to end.

## Portable Transfer Contract

### Include

Export the application-owned state needed to reconstruct the workspace:

- workspace identity, name, schema version, and timestamps;
- projects and chats;
- branch topology, anchors, selections, prompts, and the immutable context
  snapshot;
- messages and their complete versioned envelopes;
- durable completed/failed/cancelled run history that is meaningful across
  providers;
- blob descriptors and every referenced object byte stream; and
- manifest format, envelope, schema, and migration versions, record counts,
  object counts, and a digest of the completed export.

Use public IDs for every entity and relationship in exported data. Preserve
timestamps when they are domain history, but recompute caches and operational
timestamps where the import policy says they are derived.

### Recreate or remap

The target deployment owns these values:

- Convex `_id` and `_creationTime` values;
- `workspaceId` and every other Convex-ID relationship;
- the importing Better Auth user and owner membership;
- `createdByUserId` and `requestedByUserId`, according to an explicit author
  mapping policy;
- object backend (`r2` in cloud, `filesystem` locally);
- blob lifecycle/attestation state while bytes are copied; and
- derived indexes, latest-message pointers, counters, and other caches after
  their source records exist.

For the first single-user transfer, map local anonymous authorship to the
authenticated importing user. Before collaborative transfer ships, define how
known cloud identities are matched, how unknown authors are represented, and
whether invitations transfer. Never infer authority from an exported user ID.

### Exclude

Do not export or import:

- Better Auth users, sessions, accounts, OAuth state, cookies, or secrets;
- Codex or Claude credential caches, OpenRouter keys, or any other provider
  credential;
- provider-native session/thread IDs;
- active run leases, capability hashes, handoff state, scheduled functions, or
  in-progress transient jobs;
- auth audit logs, analytics outbox rows, dev magic links, environment
  variables, deployment configuration, or application code; and
- local absolute paths, R2 credentials, bucket URLs, signed URLs, or embedded
  Convex admin credentials.

User-specific presentation state such as pinned/read/unread status should be
recreated for the importing user unless product requirements explicitly make it
portable. Record that choice in the portable schema before implementing it.

## Transfer Workflow

### 1. Prepare the source

1. Authorize the actor as an active workspace owner.
2. Verify that the target mode is fully provisioned and the account has
   entitlement and quota.
3. Settle or cancel active runs; never export a live lease as durable state.
4. Establish a consistent snapshot. The simplest first implementation may
   briefly block writes for this workspace. A later online exporter may use a
   workspace generation/checkpoint and retry if the generation changes.
5. Page every table through a `workspaceId`-first index. Do not use unbounded
   `.collect()` calls.

### 2. Build the export

1. Translate all Convex relationships to public IDs.
2. Hydrate and validate every message envelope and referenced object.
3. Write a deterministic manifest and newline-delimited entity streams so large
   workspaces do not need to fit in memory.
4. Include per-object SHA-256, byte length, media type, and envelope version.
5. Validate record counts, unique IDs, graph topology, branch snapshots,
   selections, references, and hashes before offering the export to the target.
6. Exclude secrets and local implementation details by construction, not by a
   post-export scrub.

### 3. Stage the target

1. Authenticate the target user normally; do not accept an exported owner ID.
2. Create a durable import job keyed by the source workspace public ID,
   portable schema version, and export digest.
3. Create an invisible staging workspace with the target storage mode. Prefer
   an explicit workspace lifecycle state or import record over relying on a
   naming convention.
4. Delay the active owner membership, or otherwise make authorization reject
   the workspace, until activation.
5. If the same import key already completed, return the existing workspace. If
   the public ID exists with a different digest, fail with an explicit conflict
   instead of merging ambiguous histories.

### 4. Import metadata in batches

Allocate new Convex documents and maintain a durable
`<entity type, public ID> -> target _id` mapping. Import dependency roots first,
then patch cyclic and derived references after all required IDs exist. The
likely phases are:

1. workspace and project roots;
2. chat skeletons;
3. branch, message, and run skeletons;
4. branch anchors/context, chat roots/latest pointers, message reply/run links,
   and run input/output links; and
5. recomputed counters, caches, and user-specific defaults.

Each batch must be idempotent, cursor-based, bounded by Convex limits, and safe
to retry after the worker stops. An application transfer job is responsible for
cross-deployment and object-copy orchestration. Use `@convex-dev/migrations`
for in-deployment schema backfills, not as an implicit cross-deployment
transport.

### 5. Copy objects

1. Stream immutable objects from the source filesystem to private R2; do not
   buffer the whole workspace or assume every object fits in one function call.
2. Preserve the portable content-addressed key when the workspace public ID is
   preserved.
3. Verify SHA-256 and byte length at both source read and target write.
4. Reserve each target blob manifest as `r2`, upload and attest the bytes, then
   mark it available.
5. Treat an existing key as a deduplication hit only when all integrity metadata
   matches. A mismatch is corruption or a collision and must fail closed.

Database and R2 updates cannot share one transaction. Staging plus immutable,
verified objects is the atomicity boundary.

### 6. Verify and activate

Before activation:

- rerun portable shape and reference validation against target data;
- compare entity/object counts and the export digest;
- verify every target blob is available and readable;
- materialize representative and boundary-case branch transcripts and compare
  them with the source, including child branches created before later parent
  turns; and
- confirm no source `_id`, local path, credential, provider session, active
  lease, or filesystem manifest remains.

Activate with one short Convex mutation that records completion and grants the
authenticated user an active owner membership. The local source remains
authoritative and intact until the target is verified and the user separately
chooses to remove it.

### 7. Failure and cleanup

- Keep failed imports invisible and resumable.
- Record phase, cursor, counts, last safe checkpoint, portable version, and
  export digest without logging message content or secrets.
- Retry idempotently from the last checkpoint.
- Garbage-collect abandoned staging rows and R2 objects only after confirming
  they are not referenced by a completed workspace.
- Never delete or mutate the source as automatic rollback behavior.

## Schema and Version Evolution

Portable schema versions are independent of the Convex backend binary, SQLite
data format, and current table layout.

- Keep readers for every supported portable version and migrate into one
  current in-memory/import representation with pure, deterministic steps.
- Add fixtures for the oldest supported version and every version boundary.
- When changing persisted Convex shapes, use widen -> dual read/write ->
  cursor-based idempotent backfill -> verify -> narrow.
- Prefer new optional fields and explicit versions over changing a field's
  meaning in place.
- Deploy compatible code and schema to the target before importing data.
- Do not put code, environment variables, scheduled functions, or secrets in a
  workspace export.
- Never tie portable compatibility to the ability to open an old embedded
  SQLite database directly.

## Work That Makes Future Transfer Easier

Apply these rules before cloud mode exists:

- Keep stable public IDs on all portable entities and ensure new cross-entity
  relationships have a public-ID representation in the portable contract.
- Keep every tenant-owned table exportable through a bounded
  `workspaceId`-first index.
- Classify each new field as portable source state, portable history, derived
  state, user-specific state, or transient state when it is added.
- Keep full message bodies and artifacts behind versioned object envelopes and
  portable content-addressed keys.
- Make content immutable after its digest is published; represent edits as new
  versions or objects.
- Keep provider credentials and provider-native continuity outside the chat
  graph, and prove reconstruction without them.
- Avoid business logic that depends on Convex `_creationTime`; preserve an
  explicit domain timestamp when ordering/history must transfer.
- Design long-running jobs with durable cursors, cancellation, retry, progress,
  and cleanup from the start.
- Preserve a hidden/staging lifecycle for any future workspace creation API so
  partial imports are never visible.
- Keep local and cloud object adapters behaviorally equivalent with shared
  integrity and confinement tests.
- Add a headless export/import round-trip before adding transfer UI. Run it
  between two isolated deployments and two object backends.

## Implementation Milestones

1. Reconcile portable V1 with current persistence, especially immutable branch
   context, and add lossless conversion tests.
2. Implement a read-only local exporter and deterministic archive writer.
3. Implement a headless importer into a second isolated local Convex deployment
   with a separate filesystem object root.
4. Add durable staging, retry, conflict, cancellation, and cleanup behavior.
5. Add an R2 test target and prove filesystem-to-R2 object transfer and
   attestation.
6. Integrate cloud Better Auth ownership, entitlements, quotas, and the
   workspace-scoped gateway.
7. Activate the existing Playwright transfer contracts and add failure
   injection, concurrency, scale, and security cases.
8. Add product UI only after the headless path passes all release gates.

## Verification and Release Gates

At minimum, cover:

- every supported portable version and migration step;
- empty, ordinary, branched, and large workspaces;
- child-branch context snapshots after later parent messages;
- messages containing every supported part and object type;
- duplicate public IDs, missing references, invalid selections, and hash/length
  mismatches;
- interrupted export and every import phase, followed by successful resume;
- repeated import of the same export and conflicting import of a different
  export with the same workspace public ID;
- active runs and concurrent source writes at export time;
- authorization by a different user or workspace;
- proof that credentials, auth records, local paths, leases, and provider
  sessions never enter the archive;
- source/target transcript and materialized-context equivalence;
- filesystem-to-R2 and R2-to-filesystem transfers; and
- cleanup of abandoned staging state without affecting completed workspaces or
  the source.

The existing cases in
[`tests/e2e/portability/transfer.spec.ts`](tests/e2e/portability/transfer.spec.ts)
are the user-level acceptance contract. Follow [`docs/TESTING.md`](docs/TESTING.md)
when turning them on and keep local and cloud persistence/execution variants
MECE.
