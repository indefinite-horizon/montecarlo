/** Placeholder nightly project to keep scheduled external checks wired. */

import { test } from "@playwright/test";

test("nightly checks are opt-in", async () => {
  test.skip(true, "Add provider-specific nightly checks before enabling this project.");
});
