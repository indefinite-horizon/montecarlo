---
description: All user-facing system text must use locale keys instead of hardcoded strings
globs: "**/*.{ts,tsx}"
alwaysApply: false
---

# i18n for user-facing text

When adding or changing user-facing system text:
- Do not hardcode labels, placeholders, toasts, empty states, dialog copy, or tooltips.
- Add or update locale keys instead, then reference them through the project's i18n layer.
- After changing locale keys, run `bun run translate` and `bun run validate:i18n`.

This rule is about product and system copy shown to users. Internal comments, test names, and developer-only logs do not need i18n.
