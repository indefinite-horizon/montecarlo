---
name: verify-with-screenshot
description: Verify UI changes with screenshot evidence by running a one-off Playwright capture against the local run_local.sh stack.
---

# Verify With Screenshot

1. Create a temporary Playwright script under `.context/`.
2. Run it with `bash scripts/run_local.sh --command "bunx playwright test <script-or-spec>"`.
3. Save screenshots under `.dev/screenshots/<timestamp>-<slug>/`.
4. Confirm each PNG exists and describe what it proves.

Use existing helpers in `tests/e2e/helpers/` for login and fixture setup.
