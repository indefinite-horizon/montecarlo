---
description: How to author .agents/rules files — frontmatter format, glob scoping, and specificity
globs: .agents/rules/*.md
alwaysApply: false
---

# Rule authoring standards

Every file in `.agents/rules/` must include YAML frontmatter with three fields:

```yaml
---
description: One-line summary of what the rule enforces
globs: <glob pattern(s)>
alwaysApply: <true|false>
---
```

## Field reference

| Field | Required | Purpose |
|-------|----------|---------|
| `description` | Yes | Short summary used for display and relevance matching |
| `globs` | Yes (unless `alwaysApply: true`) | File patterns that trigger the rule when matched |
| `alwaysApply` | Yes | If `true`, rule loads in every session regardless of globs |

This format is compatible with Claude Code (`.claude/rules/`), Cursor (`.cursor/rules/`), and GitHub Copilot (via `applyTo`). OpenAI Codex does not yet support glob-scoped rules.

## Glob specificity: prefer narrow over broad

Always use the **most specific glob that covers the rule's actual scope**. Overly broad globs cause rules to load into irrelevant contexts, diluting their signal.

Decision order:
1. **Single file** — `convex/schema.ts` — when the rule is about one file
2. **Directory + extension** — `convex/functions/*.ts` — when scoped to a layer
3. **Subtree + extension** — `apps/web/src/components/**/*.tsx` — when scoped to a feature area
4. **Extension-only** — `**/*.{ts,tsx}` — only when the rule genuinely applies everywhere that extension appears
5. **`alwaysApply: true`** — only for behavioral rules with no meaningful file trigger (e.g. tool-output conventions)

Bad: using `**/*.ts` for a rule that only matters in `convex/`.
Good: using `convex/**/*.ts`.

## Glob syntax

- Comma-separated patterns: `convex/functions/*.ts, convex/lib/*.ts`
- Brace expansion: `**/*.{ts,tsx}`
- Patterns starting with `*` or `{` must be quoted: `"**/*.ts"`
- Prefer separate entries over complex brace patterns for clarity

## When to use `alwaysApply: true`

Only for rules about agent behavior that cannot be meaningfully tied to a file pattern — e.g. tool-output conventions, communication style, or process rules that apply regardless of which files are being edited.
