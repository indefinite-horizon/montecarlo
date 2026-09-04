# Security

Monte Carlo has four trust boundaries: the renderer, Convex control plane,
loopback model runtime, and workspace object store. A chat may cross all four;
provider credentials must cross none of them except the runtime that uses them.

## Reporting a Vulnerability

Report suspected vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/indefinite-horizon/montecarlo/security/advisories/new).
Please do not disclose security issues in public GitHub issues or discussions.

## Baseline

- Better Auth cookies use secure cookies outside local development.
- Better Auth CSRF checks are not disabled.
- Production rejects placeholder or too-short `BETTER_AUTH_SECRET` values.
- Auth session/account events are written to `auth_audit_logs`.
- Analytics properties reject obvious PII, credentials, URLs, prompts, and nested payloads.
- Convex HTTP routes expose Better Auth and health endpoints by default.
- CI runs audit, lint, typecheck, tests, build, codegen freshness, i18n validation, and Playwright projects.
- Every tenant read and write resolves the Better Auth caller and active workspace membership.
- The local companion accepts only loopback Host headers, exact configured origins, bounded bodies, and a bearer token outside explicit development mode.
- Electron uses a sandboxed, context-isolated renderer, denies permissions and new windows, opens only credential-free HTTP(S) links in the system browser, and exposes narrow typed IPC only.
- Packaged Electron binds its bundled Convex backend explicitly to
  `127.0.0.1`, disables upstream beaconing, redacts server logs sent to clients,
  and never exposes its instance secret or derived admin key to the renderer.
- macOS update metadata remains invisible until the universal app, nested
  executables, DMG, notarization ticket, feed hashes, and compatibility contract
  pass the release gate.
- The trusted client verifies the runtime upload receipt, hash, and byte length before requesting manifest availability. This is a local-mode integrity check, not server-side attestation for a future multi-tenant gateway.

## Sensitive Data

Never expose these through query return values, action args, logs, analytics,
errors, screenshots, or client state:

- API keys, OAuth tokens, deploy keys, and provider secrets
- `BETTER_AUTH_SECRET`, session tokens, cookies, and magic-link tokens
- verification codes and other credential material
- request headers, env vars, raw provider payloads, prompts, and message bodies

The exception to “client state” is the shortest-lived input buffer needed while
a user pastes a provider key. The web build never persists that value. Electron
passes it over IPC to `safeStorage`, then clears the field and restarts the
runtime with the decrypted secret. No IPC method returns secret plaintext.

## Local Account-Free Mode

Local workspaces can run without a cloud account. This is not a cloud auth
bypass: `ALLOW_LOCAL_ANONYMOUS_WORKSPACES=true` is honored only when `SITE_URL`
is a loopback origin. The local Convex deployment is expected to bind to the
user's machine; packaged Electron enforces `127.0.0.1`, and the runtime
independently binds to loopback. Never set this
flag on a shared or cloud deployment.

## Provider Boundary

- Codex authentication remains in the official CLI credential store. Monte
  Carlo may invoke `codex login --device-auth`, but does not read the auth cache.
- Codex app-server children receive an allowlisted environment and an empty,
  temporary working directory. Shell, patch, web, app, plugin, browser, and
  computer tools are disabled. Configured MCP capabilities are disabled per
  thread and verified absent before a user prompt is sent.
- Packaged macOS Electron reads a bounded allowlist from the login shell once
  at startup. It uses the result only to merge tool paths, recover local tool
  context such as `SSH_AUTH_SOCK`, and resolve provider executables. Provider
  commands are spawned directly, and shell output and local paths are never
  logged.
- OpenRouter keys come from Electron's encrypted store or an explicitly trusted
  local runtime environment.
- A managed OpenRouter key is used only with the configured managed endpoint;
  request-selected endpoints never receive it.
- Ollama endpoints must resolve to loopback.
- Claude Pro/Max authentication remains in the official Claude CLI credential
  store. Monte Carlo may invoke the CLI login flow, but does not read its cache.
  Claude CLI and Agent SDK children receive the same narrow local-tool
  environment as Codex; runtime bearer, attestation, and unrelated provider
  secrets are excluded.

## Object Storage

Portable keys are relative, versioned identifiers. Filesystem adapters reject
absolute paths, traversal, and symlink escape. R2 buckets are private; access
credentials live only in the runtime environment. Convex stores hash, size,
media type, backend, lifecycle status, and a portable object key—not the body or
a signed URL. The current companion is loopback-only. A future production
gateway must issue short-lived per-user/per-workspace capabilities and attest
the object before changing its manifest status; one shared bearer across
tenants is prohibited.

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
