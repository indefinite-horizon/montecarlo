# Design

Monte Carlo is quiet, warm, editorial, and application-first. It follows the
Socrates pattern of cream surfaces, near-black type, terracotta actions,
restrained borders, compact controls, and serif display copy. The branch graph
adds blue/gold only when another hue improves path recognition.

## UI Stack

- Use shadcn/ui primitives in `apps/web/src/components/ui/`.
- Keep `apps/web/components.json` aligned with Tailwind v4 and the `@/` alias.
- Use lucide icons for recognizable button actions.
- Keep cards for focused panels, dialogs, and repeated items. Do not nest cards.

## Layout

- Desktop uses a project/chat sidebar, centered transcript, and branch map.
- The transcript stays readable at roughly 48rem even on wide windows.
- Mobile prioritizes the transcript; navigation and the branch map become sheets.
- Use full-width page bands or simple constrained content, not floating section cards.
- Keep forms narrow enough to scan.
- Keep app pages dense but calm; avoid oversized hero treatment in product surfaces.
- Set stable dimensions for toolbars, buttons, tiles, and fixed-format controls.
- Align trailing sidebar actions on one shared vertical axis. Project creation,
  project-level chat creation, and chat archival use the same action slot, and
  project-level chat creation stays visible while its project is expanded or collapsed.
- Keep secondary sidebar affordances visually quiet and consistent. Icon actions,
  hover-revealed project toggles, and shortcut hints use `text-muted-foreground`
  at rest, on hover, and on focus instead of brightening to foreground text.

## Navigation And Context

- Let the active context, rather than static product branding, lead application
  chrome.
- Show location as a compact hierarchy from stable parent to active object. Omit
  unavailable levels and truncate gracefully while keeping the active item
  prominent.
- Preserve complete in-app context across navigation. Keep history controls
  within app-owned destinations and disable them at boundaries rather than
  allowing an unexpected exit.
- Keep frequent global actions visible with short verb labels; use a searchable
  command surface for broader action discovery.

## Typography

- Keep titles and headings in sentence case by default. Do not uppercase them
  unless the user or product specification explicitly calls for uppercase.

## Interaction Hierarchy

- Put controls close to the work they affect. Configuration for the next action
  belongs near that action; global navigation and application-wide state belong
  in the surrounding shell.
- Keep the primary work surface usable while secondary data loads. Disable only
  the action that is genuinely unavailable, and preserve entered text, focus,
  and selection across loading and configuration changes.
- Use progressive disclosure for secondary choices. Keep frequent actions
  visible, place larger option sets in menus, and move creation or editing flows
  that require validation into dialogs.
- Do not overload a selector with creation. Opening a selector should first show
  the available choices, with creation exposed as a distinct, clearly labeled
  action.
- Prefer one coherent interaction surface over parallel surfaces with overlapping
  jobs. Search and action discovery, for example, should share a single palette
  when users benefit from moving fluidly between them.

## Controls

- Buttons are for commands.
- Inputs and textareas are for text.
- Checkboxes, switches, and segmented controls are for boolean or small option sets.
- Menus and selects are for larger option sets.
- Co-located controls should share a visible height and hit-target size unless
  visual hierarchy intentionally distinguishes them.
- Icon-only buttons need accessible labels and hover/focus tooltips. Include a
  shortcut hint in the tooltip when one exists.
- A control should communicate its current value or selection through more than
  color alone, using text, icons, checkmarks, or semantic state attributes.

## Compact State Controls

- For binary or short ordered settings, prefer direct manipulation over a menu.
  Activation should update or advance exactly one supported state, and a short,
  predictable sequence may wrap.
- Make state legible through fill, intensity, progressive marks, or a concise
  label. Each visual step must map one-to-one to an available state rather than
  a fixed decorative scale.
- Keep inactive controls quiet and active controls unmistakable without changing
  hit-target size or making neighboring controls jump.
- Use a popover only when people need non-sequential access, comparison, or
  supporting detail.
- Use `aria-pressed` for binary controls. Multi-state controls should expose the
  current value in their accessible name.

## Keyboard And Command Discovery

- Every keyboard shortcut must have an accessible pointer-driven equivalent.
- Show shortcuts using the conventions of the current platform, both where the
  command is discovered and where it is invoked.
- Reserve global shortcuts for frequent, safe actions. Context-specific commands
  should only be active where their effect is unambiguous.
- Keep tooltips compact and action-oriented. When a shortcut is present, separate
  it visually from the label and avoid padding that makes the hint feel like a
  menu.
- Reveal shortcut hints on hover, focus, or selection when persistent display
  would add noise. A shortcut should never be the only way to discover or invoke
  an action.
- Use the command palette as the central place to search and discover broadly
  useful actions. Keep its results grouped, concise, and fully keyboard navigable.
- After a menu, palette, or dialog closes, return focus to the control or work
  surface from which the user should naturally continue.

## Feedback And Capability

- Acknowledge user actions immediately. Use toasts for ephemeral success, error,
  and completion feedback; use inline notices only when the state must remain
  visible or needs an in-context action.
- For simple, low-stakes actions such as copying a text block, do not show a
  toast. Momentarily replace the copy icon with a checkmark while preserving the
  button's styling, size, and position.
- Scope loading and disabled states as narrowly as possible. Background startup,
  discovery, or refresh work should not make unrelated controls appear broken.
- Only present options that the current context supports. When an unavailable
  control must remain visible for comprehension, explain why it is disabled.
- Keep dependent settings internally consistent when an upstream choice changes,
  rather than retaining a value that can no longer take effect.

## Persistent Toggles

- Controls that reveal and hide anchored UI should keep the same icon and screen
  position across states. Avoid making users chase a control after invoking it.
- Prefer state-neutral icons. Communicate the available action and current state
  through the tooltip, accessible label, and state attributes such as
  `aria-expanded`.
- Place a toggle at the edge nearest the region it controls, outside unrelated
  actions. Match the surrounding layout dimensions and spacing across states so
  the control does not jump.
- Show one instance of a persistent toggle at a time, even when ownership moves
  between the revealed region and its surrounding layout.

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

## Naming

- Give new objects a friendly, distinct working name immediately; do not block
  creation on generated metadata.
- Once intent is clear, refine machine-assigned placeholders into short,
  scannable names that read naturally in navigation and breadcrumbs.
- Prefer familiar language over novelty, retain a useful fallback when automatic
  naming fails, and never overwrite a person's edit.

## Branching

- A text selection gets one compact floating action near the selection.
- The branch composer always shows the selected passage and what context will be inherited.
- Prompt-only branching requires a prompt; selection branching makes it optional.
- A non-empty branch prompt immediately starts the child branch's first model turn.
- The parent never changes when a child branch is created.
- Active paths are distinguishable by position, label, and border—not color alone.

## i18n

- Put user-facing copy in locale files.
- Do not build strings by concatenating translated fragments.
- Re-run `bun run validate:i18n` after copy changes.
