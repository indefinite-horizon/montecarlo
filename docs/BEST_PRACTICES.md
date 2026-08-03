# Best Practices

These conventions keep Monte Carlo portable across providers, workspace modes,
and future schema versions.

## Convex

- Keep queries and mutations small, explicit, and named after user-visible operations.
- Use indexes for bounded queries; do not scan tables and filter in memory.
- Put uniqueness checks in the same mutation that writes the row.
- Keep generated Convex files checked in, but do not hand-edit them.
- Keep action-only provider calls in `convex/actions/` and pass sanitized data in.
- Do not pass credentials as Convex action args; read secrets inside the action from env.

## Schema And IDs

- App tables should use snake_case names and `by_*` index names.
- Prefer `Id<"table">` over plain strings once data is inside Convex.
- Never use `""` as an ID fallback.
- Keep Better Auth records separate from app-owned user/profile records. Better Auth owns credentials, sessions, and provider accounts; the app `users` table exists for app references and joins.

## Errors

- User-facing errors should be specific enough to act on without leaking secrets.
- Backend domain errors should be typed or tagged when the caller can recover.
- Use the shared Effect helpers for action-oriented workflows that benefit from typed failures.
- Do not expose raw provider responses, stack traces, headers, or request bodies to the client.

## Forms And Validation

- Validate at the server boundary even when the frontend already validates.
- Persist only normalized data, not raw form payloads.
- Keep user-facing text in locale files and run `bun run validate:i18n`.

## Dependencies

- Reuse existing packages and local helpers first.
- Add package dependencies only when reimplementing the behavior would be fragile or large.
- Prefer vendoring tiny permissive packages under `vendor/` when practical.
- Run the critical dependency audit before shipping dependency changes.

## File Shape

- Keep files focused. Extract helpers when a file becomes hard to scan.
- Keep source files headed by a short description comment.
- Avoid unrelated refactors in feature or fix PRs.
- Keep tests close to the behavior they protect.
