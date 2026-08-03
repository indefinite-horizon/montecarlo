# Design

The starter UI is quiet and application-first: compact forms, restrained
colors, direct controls, and no marketing shell before the real product
workflow.

## UI Stack

- Use shadcn/ui primitives in `apps/web/src/components/ui/`.
- Keep `apps/web/components.json` aligned with Tailwind v4 and the `@/` alias.
- Use lucide icons for recognizable button actions.
- Keep cards for focused panels, dialogs, and repeated items. Do not nest cards.

## Layout

- Use full-width page bands or simple constrained content, not floating section cards.
- Keep forms narrow enough to scan.
- Keep app pages dense but calm; avoid oversized hero treatment in product surfaces.
- Set stable dimensions for toolbars, buttons, tiles, and fixed-format controls.

## Controls

- Buttons are for commands.
- Inputs and textareas are for text.
- Checkboxes, switches, and segmented controls are for boolean or small option sets.
- Menus and selects are for larger option sets.
- Icon-only buttons need accessible labels.

## Buttons

- Primary buttons should represent the main action in the current context.
- Secondary and outline buttons are for supporting actions.
- Destructive actions should use the destructive variant and should require confirmation if the action is hard to undo.
- Prefer an icon plus text for important commands when the icon clarifies the action.

## Dialogs

- Dialogs should have a clear title, concise description, and an obvious primary action.
- Keep dialog body content scrollable when height can vary.
- Do not let tab changes resize a dialog dramatically.
- Confirmation dialogs should name the action and the affected object.

## Loading And Empty States

- Loading states should preserve layout size where possible.
- Empty states should say what is missing and provide the next useful action.
- Avoid decorative placeholder art unless it carries domain meaning.

## i18n

- Put user-facing copy in locale files.
- Do not build strings by concatenating translated fragments.
- Re-run `bun run validate:i18n` after copy changes.
