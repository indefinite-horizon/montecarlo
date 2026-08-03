---
description: Prefer derived state, event handlers, and approved hooks over direct useEffect in app code
globs: apps/web/src/**/*.{ts,tsx}
alwaysApply: false
---

# No direct useEffect

In application code, do not import or call `useEffect` directly when a clearer pattern exists.

Preferred alternatives:
1. Derive state during render or with `useMemo`.
2. Move user-triggered side effects into the event handler.
3. Use `useMountEffect` for mount-only work.
4. Use `useEventListener` for browser event subscriptions.
5. Use a React `key` reset when remounting is the clearest state model.

If a direct `useEffect` is truly necessary, add `// lint-allow: no-direct-use-effect — <reason>` immediately above it and explain why the approved patterns do not fit.
