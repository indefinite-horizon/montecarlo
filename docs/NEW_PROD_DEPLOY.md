# New Production Deploy

Use this runbook when creating a production Convex deployment and pointing a
Vercel frontend at it.

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

## 8. Roll Back

If the new deployment has a production-blocking issue:

1. Restore the previous Vercel `CONVEX_DEPLOY_KEY`.
2. Restore the previous `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`.
3. Redeploy Vercel.
4. Point third-party callbacks back to the previous `CONVEX_SITE_URL` if they were changed.

Keep the old Convex deployment available until the new deployment has passed
smoke checks and callback verification.
