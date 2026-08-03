---
description: Avoid adding new package.json dependencies; vendor small permissive-licensed packages under vendor/ instead
globs: **/package.json
alwaysApply: false
---

# Minimize new package.json dependencies

When editing any `package.json` (root or workspace), treat adding a new dependency as a last resort. Each new package expands the supply-chain attack surface and adds transitive maintenance cost.

## Decision order

1. **Reuse existing primitives or packages first.** Check what's already in `package.json` and the standard library (Node, Bun, Web APIs). Prefer a few lines of plain code over a new dep.
2. **Only add a new dependency** if re-implementing would be genuinely messy, error-prone, or meaningfully large (e.g. a battle-tested parser, cryptographic primitive, or non-trivial protocol client).
3. **If the dependency is small and has a permissive license** (MIT, Apache-2.0, BSD, ISC, 0BSD), vendor it under `vendor/<pkg-name>/` instead of adding it to `dependencies`:
   - Copy the relevant source files (and the `LICENSE` file) as-is into `vendor/<pkg-name>/`.
   - Import from the vendored path, not via the package manager.
   - Record the upstream source URL and version in a short `vendor/<pkg-name>/README.md` so future updates are traceable.
4. **Only add to `dependencies` / `devDependencies`** when the package is too large to vendor practically, or has a non-permissive license, or has native bindings / complex build steps that make vendoring impractical.

## What counts as "small / lightweight"

Rough heuristics — not hard limits:
- A handful of source files (single-digit count), mostly pure TS/JS.
- No native bindings, no build step, few or zero transitive deps.
- The logic fits in a reader's head after one read-through.

If the package has 50+ transitive deps or ships a significant toolchain, it's not a vendoring candidate — re-evaluate whether you actually need it.

## Popularity floor — avoid obscure packages

**AVOID AT ALL COSTS** packages with either:
- Fewer than **10k weekly npm downloads**, or
- Fewer than **1k GitHub stars**.

Low-popularity packages have far fewer eyes on their code and releases, which is exactly where supply-chain compromises land first. This applies whether you plan to add the package to `dependencies` or vendor it under `vendor/`.

Before adding any new package (direct or transitive-by-choice), check both numbers on npm and GitHub. If a candidate fails either threshold, **stop and ask the user to confirm** before installing. Include the actual download count, star count, and why no more-popular alternative works.

## Documented exceptions

The following packages fail one of the rules above but are intentionally kept as npm deps. Don't re-audit them unless their situation changes.

- **`class-variance-authority`** — part of the default shadcn/ui CLI template (added automatically by `shadcn@latest init` + `button` / `badge`). Passes the popularity floor. Would otherwise be a vendoring candidate by size, but we follow the template.
- **`tw-animate-css`** — part of the default shadcn/ui Tailwind v4 template (replaced `tailwindcss-animate` in v4). ~742 GitHub stars is below the 1k threshold, but ~13M weekly npm downloads is far above the 10k threshold, and it's the widely-adopted template default.
- **`i18next-browser-languagedetector`** — ~963 GitHub stars, just under the 1k threshold, but published by the `i18next` org (flagship repo has 8k+ stars) with ~5M weekly downloads.

## License check before vendoring

Confirm the license is one of: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD. Copy the upstream `LICENSE` file verbatim into `vendor/<pkg-name>/`. Do not vendor code under GPL/AGPL/LGPL, SSPL, BSL, or unknown licenses.

## Why

- Every added dependency is a live trust relationship with an upstream maintainer and their build chain.
- `bunfig.toml`'s `minimumReleaseAge` already gates freshly published versions; keeping the dep count low compounds that protection.
- Vendored code is auditable in-tree and can't be silently replaced by a compromised registry publish.
