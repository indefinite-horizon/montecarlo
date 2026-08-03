---
description: Exported React components should be wrapped with memo in app component files
globs: apps/web/src/components/*.tsx
alwaysApply: false
---

# React memoized exported components

In `apps/web/src/components/*.tsx`:
- Wrap exported components with `memo(...)`.
- Wrap `forwardRef(...)` exports with `memo(forwardRef(...))`.
- UI primitives in `apps/web/src/components/ui/` are exempt.

If an export is a justified exception, add `// lint-allow: no-memo-component — <reason>` immediately above it.
