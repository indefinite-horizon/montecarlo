---
description: Convex queries should always flow through an index
globs: convex/**/*.ts
alwaysApply: false
---

# Convex query indexes

When reading or writing Convex query code:
- Start from a defined index with `.withIndex(...)`.
- Do not scan a full table and then narrow with `.filter(...)` unless the data set is already intentionally bounded in an earlier step.
- Avoid `.collect()` for user-facing list queries when you really need a bounded page of results.
- Prefer an indexed query plus explicit ordering and `.take(n)` for small bounded reads, or Convex pagination APIs for real paginated flows.
- If the needed index does not exist yet, add it in `convex/schema.ts` before landing the query.

Examples:
- Good: `.withIndex("by_workspaceId", (q) => q.eq("workspaceId", id)).order("desc").take(20)`
- Bad: `.withIndex("by_workspaceId", ...).collect()` and then slicing in application code

Prefer shaping the data model around the access pattern instead of working around a missing index in application code.

## No speculative indexes

Only add a schema index once the codebase has a concrete query or mutation ready to use it. Do not preemptively add indexes for possible future access patterns — dead indexes accumulate silently and cost real storage.

When adding an index to `convex/schema.ts`, the same change must include at least one caller using `withIndex("...")` (or the corresponding search-index API) against the new index. If the caller lands in a later PR, the index should too.
