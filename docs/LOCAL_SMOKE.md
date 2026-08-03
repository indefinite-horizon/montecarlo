# Local Smoke Checks

Use this after changes that affect auth, routing, local env, or the frontend
shell.

## Local Stack

```sh
bash scripts/run_local.sh
```

Open the printed Vite URL and verify:

- the login page renders
- `test@test.local` signs in through the local magic-link auto-redirect
- the home page renders
- theme toggle works
- language toggle works
- sign-out returns to login

## Health Endpoints

Check the Convex site URL from `.env.local`:

```sh
curl "$CONVEX_SITE_URL/api/health/live"
curl "$CONVEX_SITE_URL/api/health/ready"
```

Expected shape:

```json
{ "ok": true }
```

## Deployed Smoke

For a deployed environment:

- open the frontend URL
- confirm the frontend is calling the intended `VITE_CONVEX_URL`
- sign in with an email magic link or Google OAuth if enabled
- check `/api/health/live` and `/api/health/ready` on `CONVEX_SITE_URL`
- verify analytics is intentionally enabled or disabled
