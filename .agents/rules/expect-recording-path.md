---
description: Always emit the file path to expect recording HTML after running an expect session
globs:
alwaysApply: true
---

# Always emit expect recording path

After running an expect recording (via the `expect` skill or `mcp__expect__*` tools), always include the file path to the generated HTML recording in your response to the user.

The recording HTML file is the primary artifact the user needs to review browser interactions visually. Omitting the path forces them to hunt for it manually.
