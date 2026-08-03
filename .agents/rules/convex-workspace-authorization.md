---
description: Enforce tenant isolation and portable IDs in workspace-scoped Convex code
globs: convex/**/*.ts
alwaysApply: false
---

# Convex workspace authorization

Workspace isolation is an endpoint invariant, not a client convention.

## Authentication and authorization

- At every public Convex query or mutation boundary, resolve the Better Auth
  caller with `authComponent` and map it to the app-owned `users` row.
- Never accept a user ID, auth subject, owner ID, role, or membership status as
  proof of identity from a client.
- Before any tenant read or write, call the centralized helper in
  `convex/lib/workspaceAuth.ts` with the required permission.
- Only active memberships grant access. Treat invited, suspended, removed, and
  missing memberships as denied.
- Keep missing-resource and unauthorized responses indistinguishable when that
  prevents workspace enumeration.
- Re-check that every ID loaded from arguments belongs to the authorized
  workspace and, where relevant, the expected chat or branch.
- Internal functions must receive explicit actor/workspace context from an
  already authorized boundary. Do not make an internal function public to
  avoid authorization plumbing.

## Schema and indexes

- `users` and `workspaces` are global roots. Every other tenant-owned row must
  contain `workspaceId`.
- Tenant queries must use an index whose leading field is `workspaceId`.
- The narrow exception is cross-workspace membership discovery for the current
  authenticated app user, using `workspace_memberships.by_user_status`. Do not
  expose that index through arbitrary user-ID arguments.
- Use indexed, bounded reads. Do not use `.filter()` for tenant scoping, and do
  not use unbounded `.collect()` in user-facing functions.
- Add both argument and return validators to every public function.

## Identity, uniqueness, and portability

- Give every workspace and tenant-owned row a stable `publicId` independent of
  Convex `_id`; use it in portable local/cloud archives.
- Check public-ID uniqueness and insert in the same Convex mutation. Never
  split the uniqueness query and write across an action boundary.
- Keep explicit `createdAt`/`updatedAt` fields and workspace schema versions;
  do not rely on `_creationTime` as the portable format.
- Evolve persisted data with expand -> dual read/write -> idempotent backfill ->
  contract migrations. Verify portable imports before activating them.

## Messages, blobs, and provider data

- Store message metadata, a bounded preview, hash, and `contentRef` in Convex.
  Store full bodies and large tool output in filesystem or R2 object storage.
- Blob object keys are workspace-authorized, relative, and content-addressed.
  Never persist an absolute local filesystem path.
- Never return an object key or signed URL without an active membership check.
  Keep signed URLs short-lived and configure exact CORS origins.
- Keep provider credentials, OAuth tokens, API keys, and Claude/Codex credential
  files out of Convex documents, function arguments, logs, and browser/renderer
  state. A provider session ID may be stored only when it is an opaque locator,
  not a bearer credential.
