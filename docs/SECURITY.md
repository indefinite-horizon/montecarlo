# Security

This document captures template-level security expectations. Product-specific
apps should extend it before collecting real users.

## Baseline

- Better Auth cookies use secure cookies outside local development.
- Better Auth CSRF checks are not disabled.
- Production rejects placeholder or too-short `BETTER_AUTH_SECRET` values.
- Auth session/account events are written to `auth_audit_logs`.
- Analytics properties reject obvious PII, credentials, URLs, prompts, and nested payloads.
- Convex HTTP routes expose Better Auth and health endpoints by default.
- CI runs audit, lint, typecheck, tests, build, codegen freshness, i18n validation, and Playwright projects.

## Sensitive Data

Never expose these through query return values, action args, logs, analytics,
errors, screenshots, or client state:

- API keys, OAuth tokens, deploy keys, and provider secrets
- `BETTER_AUTH_SECRET`, session tokens, cookies, and magic-link tokens
- verification codes and other credential material
- request headers, env vars, raw provider payloads, prompts, and message bodies

Convex action args are logged by Convex. Read secrets from environment variables
inside the action that uses them.

## Better Auth Checklist

Before production users:

- Generate a strong `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
- Set `SITE_URL`, `CONVEX_URL`, and `CONVEX_SITE_URL` for the production topology.
- Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` so magic-link email can be delivered.
- Review `trustedOrigins` and OAuth callback URLs.
- Keep rate limiting enabled outside local development.
- Keep OAuth token encryption enabled.
- Review auth audit logs after smoke testing.

## App Users Versus Auth Users

Better Auth owns auth users, sessions, credentials, and provider accounts in
its component schema. The app `users` table is deliberately separate. It gives
application code a stable `Id<"users">` for ownership, analytics identity,
future profile fields, and joins to app-specific tables.

Do not store auth tokens or provider credentials in the app `users` table.

## Analytics Boundary

Analytics ingestion is a separate trust boundary. Even if an app chooses to
show a user email or person/profile display name inside an authenticated
workspace, analytics events should not include that raw value as an ordinary
event property. Use IDs, counts, booleans, categories, or hashes instead.

## Deployment

Vercel env and Convex env are separate:

- Vercel build variables control the frontend bundle and deploy key.
- Convex env variables control backend runtime behavior.

Follow `docs/NEW_PROD_DEPLOY.md` when creating or rotating deployments.
