# Ontology

Use these terms when prompting agents or describing product behavior in this
template.

| Term | Meaning |
| --- | --- |
| App user | The app-owned `users` row that gives product code a stable Convex `Id<"users">`. |
| Auth user | The Better Auth identity record that owns sessions and provider accounts. |
| Auth subject | The Better Auth user ID stored on app users as `authSubject`. |
| Auth audit log | A row in `auth_audit_logs` recording security-relevant auth events such as session creation and account linking. |
| Local anonymous stack | The local Convex + Vite environment started by `scripts/run_local.sh` with `CONVEX_AGENT_MODE=anonymous`. |
| Dev auth email | The local development email `test@test.local`; the dev stack auto-opens its magic link after submit. |
| Authenticated route group | The TanStack Router `_authenticated` route group that contains routes requiring a signed-in user. |
| Analytics event | A typed, sanitized product event emitted by frontend or backend code. |
| Analytics outbox | The durable `app_events_outbox` table that stores backend analytics events before provider delivery. |
| Locale source | `apps/web/src/locales/en.json`, the source of truth for translated UI keys. |
| Desktop shell | The Electron workspace that wraps the web app for local desktop usage. |
