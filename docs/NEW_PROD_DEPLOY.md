# New Production Deploy

Use this runbook when creating a production Convex deployment and pointing a
Vercel frontend at it.

Generate deployment inputs interactively from a trusted local checkout:

```sh
bash scripts/generate_deploy_env.sh prod
bash scripts/generate_deploy_env.sh preview
```

These write gitignored `.env.prod` and `.env.preview` files for Convex and
Vercel plus separate `.env.runtime.<environment>` files containing runtime-only
blob attestation private keys. Never upload the runtime files to Convex or
Vercel. The generator prompts for PostHog configuration and enables analytics
for both the backend and browser when a project token is set. The PostHog token
is required for production and optional for preview; leave the preview prompt
blank to disable PostHog delivery in that preview. Preview generation uses
`https://dummy-preview-siteurl.indefinitehorizon.com` as its project-default
`SITE_URL`. This value is used by the hosted auth layer for OAuth and magic-link
callbacks, trusted-origin validation, and CORS; it does not select the Convex
deployment or local runtime. Because every preview has a different frontend
origin, a durable project default cannot be correct. The Vercel build therefore
replaces the dummy with that deployment's actual preview origin before the
preview is used. Production generation also optionally prompts for Google OAuth
credentials and prints the callback URI to register. Re-running
the same command preserves existing non-empty values and prompts only for values
that are missing, so it is safe to run after the template adds a new variable.
Use `--force` to re-prompt configurable values while preserving generated Better
Auth and attestation secrets. Use `--rotate-generated-secrets` only for an
intentional generated-secret rotation. Apply the generated values after
authenticating and linking both CLIs:

```sh
bash scripts/set_convex_deploy_env.sh prod
bash scripts/set_vercel_deploy_env.sh prod
bash scripts/set_convex_deploy_env.sh preview
bash scripts/set_vercel_deploy_env.sh preview
bunx vercel deploy --prod --logs
```

The Convex setup script updates project defaults for the selected deployment
type. For `prod`, deployment-specific `CONVEX_URL` and `CONVEX_SITE_URL` values
are also applied to the current production deployment. Preview deployment URLs
are generated per branch and injected by `scripts/vercel_build.sh`, so they are
never stored as project defaults or Vercel preview variables.

## 1. Create The Convex Deployment

Run from the repo root. If you already have another deployment in the same
Convex project, set `CONVEX_DEPLOYMENT` to it so the CLI has project context.
Keep `CONVEX_AGENT_MODE=false` so the command uses the normal authenticated
Convex CLI flow rather than local anonymous mode.

```sh
CONVEX_DEPLOYMENT=<existing-deployment> CONVEX_AGENT_MODE=false bunx convex deployment create
```

Choose a production deployment name that will remain meaningful after future
cutovers, such as `prod-us0` or `prod-eu0`.

## 2. Configure Domains And URL Variables

Each Convex deployment has two important public URLs:

- `CONVEX_URL`: the Convex API URL used by Convex clients.
- `CONVEX_SITE_URL`: the Convex HTTP actions/site URL used by Better Auth and health endpoints.

If you add custom domains in the Convex dashboard, select them under
environment-variable overrides for the Convex-managed URL names. In this app's
backend env, the API URL is stored as `CONVEX_URL`.

The frontend URL is separate:

- `SITE_URL`: the Vercel frontend URL used by Better Auth trusted origins and redirects.
- `VITE_CONVEX_URL`: the Convex API URL statically embedded in the web build.
- `VITE_CONVEX_SITE_URL`: the Convex site URL statically embedded in the web build.

## 3. Add Vercel Secrets

Create a Convex deploy key for the production deployment and set it in Vercel:

- `CONVEX_DEPLOY_KEY`: controls which Convex deployment `scripts/vercel_build.sh` deploys to.

Do not commit deploy keys or provider secrets. The Vercel build script deploys
Convex and then builds the web app.

## 4. Set Convex Backend Env

Set backend environment variables on the Convex deployment. Use
`convex/env.ts` as the source of truth and reconcile it with:

```sh
bunx convex env list --prod
```

Minimum production values:

- `SITE_URL`
- `CONVEX_URL`
- `CONVEX_SITE_URL`
- `BETTER_AUTH_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `APP_RELEASE_CHANNEL=production`

Never set `ALLOW_LOCAL_ANONYMOUS_WORKSPACES` on the shared deployment.

Optional values:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`
- `ANALYTICS_DISABLED=true` if analytics should be off

Generate `BETTER_AUTH_SECRET` with a high-entropy value:

```sh
openssl rand -base64 32
```

The app rejects known placeholder or short Better Auth secrets outside local
development.

## 5. Set Frontend Build Env

Set Vercel frontend variables for the environment:

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`
- `VITE_POSTHOG_PROJECT_TOKEN` if browser analytics is enabled
- `VITE_POSTHOG_HOST` if not using the default PostHog host
- `VITE_AUTH_GOOGLE_ENABLED=true` if Google sign-in should be visible

`CONVEX_DEPLOY_KEY` controls where Vercel deploys backend code.
`VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` control which backend the built
frontend calls.

## 6. Configure Redirects And Callbacks

Update third-party callback URLs for the production domains:

- Google OAuth redirect URI: `<CONVEX_SITE_URL>/api/auth/callback/google`
- Resend sender/domain: verify the domain or sender used by `RESEND_FROM_EMAIL`
- Better Auth frontend redirect allowlist: `SITE_URL`
- Any future provider webhook URL: use the production `CONVEX_SITE_URL`

Preview deployments need their own callback strategy. For OAuth providers that
do not allow broad preview redirects, keep OAuth disabled in previews or use a
dedicated preview OAuth app.

## 7. Verify The Deployment

Before sending production users to the deployment:

- Check Convex dashboard health, logs, and function errors.
- Open `<CONVEX_SITE_URL>/api/health/live`.
- Open `<CONVEX_SITE_URL>/api/health/ready`.
- Open the Vercel frontend and sign in with a magic link.
- Confirm authenticated Convex reads work by reaching the home page.
- If Google OAuth is enabled, complete one Google sign-in.
- If analytics is enabled, verify backend outbox flushes and browser captures.

## Cloud Runtime And R2

The current release supports only an authenticated loopback companion. Do not
put a runtime bearer or managed provider key in a `VITE_*` variable: browser
bundles are public, and that would let any visitor spend the managed key.

Before enabling the hosted SPA for cloud object bodies or managed OpenRouter
usage, add a gateway that exchanges the Better Auth session for a short-lived,
workspace- and provider-scoped capability. The gateway must authorize every
R2 operation, attest the uploaded hash and length before marking a manifest
available, rate-limit provider spend, and keep the bucket private. A shared
static bearer is not a supported deployment design.

## 8. Roll Back

If the new deployment has a production-blocking issue:

1. Restore the previous Vercel `CONVEX_DEPLOY_KEY`.
2. Restore the previous `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`.
3. Redeploy Vercel.
4. Point third-party callbacks back to the previous `CONVEX_SITE_URL` if they were changed.

Keep the old Convex deployment available until the new deployment has passed
smoke checks and callback verification.
