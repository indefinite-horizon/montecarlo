# Secrets and Environment Ownership

This is the canonical inventory for operator-supplied environment variables and
the boundary that owns each one. Record names and ownership only; never add real
values, token fragments, hashes, credential lengths, or screenshots.

Update this file and `.env.example` together whenever a credential, environment
variable, or runtime ownership boundary changes.

## Ownership principles

- Convex owns application authentication, OAuth, email, and backend analytics
  credentials.
- The trusted local runtime owns model-provider and object-store credentials.
- `.env.local` is the web and Convex input. `.env.runtime.local` is the trusted
  companion input. `scripts/filter_convex_env.sh` is the machine-readable
  allowlist that prevents runtime-only values from being uploaded to Convex.
- The blob attestation public key is stored in Convex, while its matching private
  key remains in the runtime. `scripts/run_local.sh` generates the pair for local
  development when either half is absent.
- Codex and Claude subscription credentials remain owned by their official local
  SDK or CLI. Monte Carlo never reads or persists their credential caches.
- Browser-visible `VITE_*` values are public configuration even when named
  `TOKEN`.
- Runtime tuning values with safe defaults stay documented in their config
  modules instead of appearing as active `.env.example` assignments.

## Cross-boundary credential pair

These values form one key pair but are never stored in the same environment.

| Variable | Secrecy | Owner | Purpose |
| --- | --- | --- | --- |
| `MONTECARLO_BLOB_ATTESTATION_PUBLIC_KEY` | public | Convex | Verifies signed loopback-runtime blob writes |
| `MONTECARLO_BLOB_ATTESTATION_PRIVATE_KEY` | secret | Runtime | Signs loopback-runtime blob writes |

## Convex-only secrets

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Better Auth session encryption |
| `GOOGLE_CLIENT_SECRET` | Optional Google OAuth |
| `RESEND_API_KEY` | Production magic-link delivery |
| `POSTHOG_PROJECT_TOKEN` | Backend analytics ingestion; optional in preview and required by the production deployment scripts |

## Runtime-only secrets

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Optional user-managed OpenRouter calls outside the desktop credential flow |
| `MONTECARLO_MANAGED_OPENROUTER_API_KEY` | Administrator-provisioned OpenRouter calls in a trusted runtime |
| `MONTECARLO_RUNTIME_TOKEN` | Authenticates requests to the companion outside development |
| `R2_ACCESS_KEY_ID` | R2-compatible object-store access key id |
| `R2_SECRET_ACCESS_KEY` | R2-compatible object-store secret key |

OpenRouter user keys saved through Electron remain in the desktop credential
boundary and are not configured as environment variables. Codex and Claude use
their official local login flows; `CODEX_PATH` and `CLAUDE_PATH` select the
executables but do not expose either provider's credential store.

## Deployment-only secrets

| Variable | Purpose |
| --- | --- |
| `CONVEX_DEPLOY_KEY` | Authorizes a Vercel build or operator command to deploy Convex |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | Authenticates the Convex CLI to an optional self-hosted deployment |

These values are CLI or build-runner inputs. They are never uploaded as Convex
backend variables.

## Convex non-secret configuration

| Variable | Purpose |
| --- | --- |
| `SITE_URL` | Application origin |
| `GOOGLE_CLIENT_ID` | Optional Google OAuth client id |
| `RESEND_FROM_EMAIL` | Transactional sender address |
| `POSTHOG_HOST` | Analytics ingestion endpoint |
| `ANALYTICS_DISABLED` | Analytics kill switch |
| `ENABLE_DANGEROUS_DEV_TOOLS` | Explicit local-only destructive-tool opt-in |
| `ALLOW_LOCAL_ANONYMOUS_WORKSPACES` | Explicit account-free local-workspace opt-in |
| `CONVEX_AGENT_MODE` | Convex CLI mode set automatically by local development and test scripts |

Convex-managed deployment selectors and URLs such as `CONVEX_DEPLOYMENT`,
`CONVEX_URL`, and `CONVEX_SITE_URL` may be written into `.env.local` by the CLI
or local runner. Deployment configuration also supplies `APP_RELEASE_CHANNEL`
and may supply `GIT_SHA`; these are allowlisted for the Convex backend but are
not operator prompts in `.env.example`.

## Runtime non-secret configuration

| Variable | Purpose |
| --- | --- |
| `MONTECARLO_RUNTIME_WORKSPACE_IDS` | Optional workspace allowlist for a locked-down companion |
| `CODEX_PATH` | Optional official Codex CLI path |
| `CLAUDE_PATH` | Optional official Claude CLI path |
| `R2_ENDPOINT` | R2-compatible object-store endpoint |
| `R2_BUCKET` | R2-compatible object-store bucket |
| `R2_PREFIX` | Optional object-key prefix |
| `MONTECARLO_WORKSPACES_DIR` | Optional filesystem object-store root |
| `OPENROUTER_BASE_URL` | Optional compatible OpenRouter endpoint override |
| `OLLAMA_BASE_URL` | Optional Ollama-compatible endpoint override |

`MONTECARLO_RUNTIME_HOST`, `MONTECARLO_RUNTIME_PORT`,
`MONTECARLO_RUNTIME_ALLOWED_ORIGINS`, and `MONTECARLO_RUNTIME_DEV` are local
runner or deployment controls with safe defaults in `apps/runtime/src/config.ts`.
`MONTECARLO_OBJECT_STORE` defaults to `filesystem`; providing the complete R2
configuration enables R2 alongside it.

## Convex CLI and deployment configuration

| Variable | Purpose |
| --- | --- |
| `CONVEX_DEPLOYMENT` | Selects a Convex project and deployment for CLI commands |
| `CONVEX_SELF_HOSTED_URL` | Selects an optional self-hosted Convex deployment |

These selectors may live in a gitignored operator env file, but are CLI inputs
rather than Convex backend variables.

## Browser and Vercel build environment

| Variable | Secrecy | Purpose |
| --- | --- | --- |
| `VITE_CONVEX_URL` | public | Browser Convex endpoint |
| `VITE_CONVEX_SITE_URL` | public | Browser and HTTP-action endpoint |
| `VITE_POSTHOG_PROJECT_TOKEN` | public | Browser analytics project token; optional in preview and required by the production deployment scripts |
| `VITE_POSTHOG_HOST` | public | Browser analytics host |
| `VITE_ANALYTICS_DISABLED` | public | Browser analytics kill switch |
| `VITE_AUTH_GOOGLE_ENABLED` | public | Enables Google sign-in UI |
| `VITE_AUTH_REQUIRED` | public | Requires authenticated web routes |
| `VITE_DEMO_MODE` | public | Enables the explicit in-memory demo fallback |
| `VITE_RUNTIME_URL` | public | Local companion endpoint |
| `VITE_RUNTIME_TOKEN` | public | Development-only companion token; never use for a deployed shared secret |

## Rotation rules

- Rotate `BETTER_AUTH_SECRET` with an explicit session invalidation plan.
- Rotate the blob attestation key pair together; never expose the private half
  to Convex, browser configuration, logs, or persisted workspace data.
- Rotate runtime provider and R2 credentials at their owning service, then
  restart the trusted companion so newly launched processes receive them.
