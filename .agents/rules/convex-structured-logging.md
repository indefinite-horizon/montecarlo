---
description: OTEL-aligned structured logging in Convex — canonical events at boundaries, manual logs only via debug/setAttributes
globs: convex/**/*.ts
alwaysApply: false
---

# Convex structured logging

Convex code uses OTEL-aligned structured logging from `convex/lib/logger.ts`. The canonical pattern is **one summary event per boundary**, emitted automatically by the wrappers — manual logging exists to enrich or debug, not to replace it.

## Rules

In `convex/` files:

- **No bare `console.log`/`warn`/`error`/`info`** — exceptions are the logger implementation itself and a small set of bootstrap files. The `no-bare-console` custom lint enforces this.
- **Canonical logs are automatic at boundaries**: request/function wrappers and outbound service clients emit one summary event per boundary plus a structured terminal error record on uncaught failures. Do **not** add ad hoc info/warn/error logs inside a handler — they duplicate or obscure the canonical record.
- **Manual logs are `log.debug(...)` only**. The `RequestLogger` intentionally exposes only `debug(...)` for manual use.
- **Enrich the current boundary via `log.setAttributes(...)`** instead of emitting a new log entry. Context you add here flows through to the canonical summary event for the boundary.
- **Include relevant context IDs** such as `workspaceId`, `conversationId`, `agentId`, `runId`, `messageId`, `userId` in the attributes object whenever available.

## OTEL correlation semantics

Use these field names consistently; do **not** invent new ones:

- `trace_id` — universal correlation key spanning an end-to-end workflow
- `span_id` — the current operation within that trace
- `parent_span_id` — the operation that triggered the current one (only set on child operations)
- `request_id` — transport-level request ID, **only when one actually exists** (e.g. a real HTTP request ID from an upstream service). Do not fabricate it.

**Never introduce `correlationId`.** It's an older name that conflicts with the OTEL model.

## Why

Each canonical event is a structured record that can be stitched into a single workflow trace via `trace_id`. Ad hoc logs break this pattern, and non-OTEL field names break correlation. Use logs that help trace one concrete workflow through the backend rather than free-form debug text.
