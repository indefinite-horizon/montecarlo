---
description: Uniqueness checks must live inside Convex mutations, not split across action runQuery/runMutation boundaries
globs: convex/**/*.ts
alwaysApply: false
---

# Convex uniqueness checks

When a field or compound key must be unique (i.e., it has a uniqueness-intended index), the "check existing + write" logic must execute inside a single Convex mutation. Convex mutations are serializable (OCC), so a check-then-write within one mutation is safe. Splitting the check (`runQuery`) and the write (`runMutation`) across an action boundary creates a race window where two concurrent calls can both pass the check and both write, producing duplicates.

## Accepted patterns

1. **Guard-and-throw**: Query the index inside the mutation, throw if a document already exists, then insert.
2. **Upsert**: Query the index, patch if found, insert if not — all in one mutation handler.
3. **Idempotent return**: Query the index, return the existing document if found, insert otherwise.

## Anti-pattern

```ts
// BAD — race window between query and mutation
const existing = await ctx.runQuery(internal.foo.lookup, { key });
if (!existing) {
  await ctx.runMutation(internal.foo.create, { key, ... });
}
```

```ts
// GOOD — check and write in the same mutation
export const create = internalMutation({
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("foo")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("foo", { key: args.key, ... });
  },
});
```

## Centralize when reused

If the same uniqueness invariant is enforced in more than one mutation, extract a shared helper (e.g., `assertHandleUnique` in `convex/lib/handles.ts`).

## When reviewing or generating code

- Flag any `runQuery` + `runMutation` pair in an action where the query checks for existence before the mutation inserts.
- Suggest folding the existence check into the mutation handler.
