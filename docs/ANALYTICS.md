# Analytics

Monte Carlo emits analytics through a first-party harness. PostHog is the
default provider, but product code should not import provider SDKs directly.

## Architecture

```
Convex mutation or action
  -> typed event builder in convex/lib/analytics/events.ts
  -> enqueueAnalyticsEvent(...)
  -> app_events_outbox
  -> cron-triggered flushOutbox action
  -> PostHog
```

Browser-only events use the matching frontend builder/provider layer under
`apps/web/src/lib/analytics/`. The backend outbox is the source of truth for
durable product events because it runs in the same transaction as the app
mutation that caused the event.

## Invariants

- Event builders are the only path in.
- Events must pass through `sanitizeProperties(...)`.
- Provider SDK imports stay behind adapter boundaries.
- Backend PostHog import is only allowed in `convex/actions/analyticsFlushNode.ts`.
- Browser PostHog import is only allowed in `apps/web/src/lib/analytics/posthogAdapter.ts`.

These boundaries are enforced by `scripts/lint-custom.ts`.

## Outbox Retention

The outbox cannot grow without bound:

- Successful events are deleted after provider delivery.
- Failed events back off and are dropped after the max attempt count.
- Stale rows are pruned by age.
- Claimed rows have a lock timeout so crashed flushes self-recover.

The flush state table stores a deployment-wide lease so ad-hoc triggers or
misconfigured crons cannot hammer the provider.

## Configuration

Backend variables:

| Variable | Required | Effect |
| --- | --- | --- |
| `POSTHOG_PROJECT_TOKEN` | no | Enables backend flushes when set. |
| `POSTHOG_HOST` | no | PostHog ingestion host. Defaults to US cloud. |
| `ANALYTICS_DISABLED` | no | Hard kill switch for backend analytics. |

Frontend variables:

| Variable | Required | Effect |
| --- | --- | --- |
| `VITE_POSTHOG_PROJECT_TOKEN` | no | Enables browser analytics when set. |
| `VITE_POSTHOG_HOST` | no | Browser PostHog host. |
| `VITE_ANALYTICS_DISABLED` | no | Hard kill switch for browser analytics. |

Local backend env is pushed with `bash scripts/setup_local_env.sh`.

## Event Catalog

Backend events:

| Event | Source | Notes |
| --- | --- | --- |
| `user signed up` | Better Auth user trigger | Includes app user ID and auth subject. |
| `user signed in` | Available builder | Use when wiring explicit sign-in tracking. |
| `app error shown` | Available builder | Use for server-side app error surfaces. |

Frontend events:

| Event | Source | Notes |
| --- | --- | --- |
| `app error shown` | route error boundary | Captures sanitized error category only. |
| `command palette item selected` | example frontend builder | Kept as a typed UI-event pattern. |

## Banned Content

Analytics properties must be flat primitives. The shared sanitizer rejects
keys that are unsafe by name alone, including:

- direct personal identifiers such as emails, phone numbers, personal names,
  government IDs, IP addresses, or addresses
- credentials, tokens, headers, env vars, or secrets
- prompts, message bodies, payloads, raw responses, or user text
- URLs with query strings or provider callback payloads

It deliberately does not reject product labels by shape alone. Keys such as
`workspace_name`, `workspace_slug`, `agent_name`, and `handle` can be valid
analytics dimensions when the event owner has decided those values are
appropriate to collect.

If a future event needs information derived from sensitive content, record a
count, boolean, category, or hash instead of the raw value.

## Adding Events

1. Add the event name and typed builder.
2. Sanitize the properties in the builder.
3. Enqueue from the success path of the owning mutation/action.
4. Add or update a focused unit test.
5. Add a row to this catalog.

## Provider Swaps

To swap providers, change only:

- backend flush implementation in `convex/actions/analyticsFlushNode.ts`
- browser adapter in `apps/web/src/lib/analytics/posthogAdapter.ts`
- env var names and docs
- lint allowlist for provider imports

Outbox shape, event builders, call sites, and the provider interface should
remain stable.
