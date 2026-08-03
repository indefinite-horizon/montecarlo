---
description: Convex schema tables use snake_case, fields use camelCase, identifiers ≤64 chars, and all persisted names must stay product-agnostic
globs: convex/schema.ts
alwaysApply: false
---

# Convex schema naming

In `convex/schema.ts`:

## Identifier length limit

Convex rejects table names, index names, and field names longer than **64 characters** at deploy time. Keep all identifiers within this limit. For compound indexes, abbreviate the name rather than concatenating every field — e.g. `by_admin_browserHash_workspace_endedAt` instead of `by_adminUserId_and_browserSessionHash_and_workspaceId_and_endedAt`.

The `schema-identifier-length` lint rule in `scripts/lint-custom.ts` catches violations before deploy.

## Casing
- Use `snake_case` for table names.
- Use `camelCase` for fields inside `defineTable(...)`.
- Do not mix the two conventions or preserve legacy naming in new schema work.

Examples:
- table: `agent_runs`
- field: `workspaceId`

## Product-agnostic naming

Persisted database identifiers — table names, field names, index names — must stay **product-agnostic**. Never include the app or product name.

- Good: `app_events`, `appVersion`, `by_app_slug`
- Bad: `template_events`, `templateVersion`, `by_template_slug`

Why: persisted identifiers outlive product names. Product rebrands, forks, and white-labeling all become schema migrations if the product name is baked into the schema. Use a neutral prefix like `app...` instead.
