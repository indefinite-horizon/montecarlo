---
name: app-config-constants
description: Internal guidance for adding or moving app constants in this template. Use when editing hard-coded defaults, limits, durations, tuning parameters, or constants that belong in convex/config.ts or lib/config.ts.
user-invocable: false
---

# App Config Constants

## Overview

Keep application constants discoverable and consistently placed. Prefer the
backend config unless the same value must be imported by frontend code.

## Placement

1. Put backend-only constants in `convex/config.ts`.
   Use this for Convex function/action/http behavior, backend retention windows,
   batch sizes, leases, retries, provider timeouts, auth backend defaults, and
   seed/runtime tuning.

2. Put shared frontend/backend constants in `lib/config.ts`.
   Use this only when frontend code and backend code need the same value. Import
   it into Convex through `../lib/config`.

3. Do not import from `convex/config.ts` inside `lib/config.ts`.
   The shared config must stay frontend-safe and must not depend on Convex,
   Node-only APIs, environment variables, secrets, or generated Convex files.

4. Do not put secrets in either config file.
   Runtime secrets belong in environment variables. The config files may contain
   names, limits, durations, feature defaults, and non-sensitive IDs only.

## Shape

- Export stable objects named `convexConfig` and `sharedConfig`.
- Group values by product area, for example `auth`, `analytics`, `http`, or
  `seed`.
- Use `as const` so consumers get literal types.
- Define small unit helpers near the top of the module, such as `oneMinuteMs`,
  when they make durations easier to audit.
- Keep derivations simple and deterministic at module load.
- Add only constants that have an immediate code consumer in the same change.
  Remove placeholder or speculative constants before finishing.

## Moving Constants

When a frontend need appears for a backend constant, move the smallest useful
value from `convex/config.ts` into `lib/config.ts`, then reference it from
`convex/config.ts`. Do not move an entire backend section just because one value
became shared.
