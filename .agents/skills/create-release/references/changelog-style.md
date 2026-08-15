# Monte Carlo release-note style

Derived from the product-writing patterns in the [Conductor changelog](https://www.conductor.build/changelog).

## Editorial contract

- Write for people using the product, not maintainers reviewing Git history.
- Turn the complete diff and PR set into a concise product changelog, not a commit log.
- Preserve every material user-visible outcome while combining related PRs into one bullet.
- Omit PR numbers, SHAs, authors, routine dependencies, refactors, tests, CI work, and implementation details unless they materially affect users, security, reliability, or operators.
- Give the release a short human title based on its strongest theme, such as the pattern “Stacks” or “Cloud Polish #2.” Do not force wordplay when no clear theme exists.
- Use only non-empty `### Improvements`, `### Fixes`, and `### Misc` sections.
- Put the most consequential benefit first in each section.
- Keep each bullet to one plain-language sentence. Prefer concrete openings such as “You can now…”, “Added…”, “Improved…”, and “Fixed…”.
- Name visible surfaces, menu paths, and keyboard shortcuts when useful.
- Describe the outcome and benefit, not the implementation.
- Collapse duplicate fixes and multiple PRs that address one symptom.
- Do not overclaim. Inspect ambiguous diffs; omit changes whose user impact cannot be established.
- A marquee feature may have one or two short introductory paragraphs before the sections. Otherwise begin with the sections.
- Do not add empty boilerplate, contributor lists, or a redundant version/date. GitHub supplies the release metadata.
