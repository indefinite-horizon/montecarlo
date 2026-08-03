---
description: Use the local shadcn/ui primitives and registry config for web UI work
globs: apps/web/src/**/*.tsx, apps/web/components.json, apps/web/src/styles/app.css
alwaysApply: false
---

# Shadcn UI primitives

When editing web UI:

- Prefer components from `@/components/ui/*` before hand-rolling controls.
- Keep `apps/web/components.json` aligned with the Tailwind v4 setup in `apps/web/src/styles/app.css`.
- Add new shadcn components as source files under `apps/web/src/components/ui/`, not as opaque generated artifacts.
- Use lucide icons in command buttons when an icon clarifies the action.
- Do not put cards inside cards. Use `Card` for focused panels, dialogs, and repeated items only.
