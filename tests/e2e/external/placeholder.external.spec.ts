/** Placeholder external-provider project to keep the Playwright split wired. */

import { test } from "@playwright/test";

test("external provider checks are opt-in", async () => {
  test.skip(true, "Add provider-specific external checks before enabling this project.");
});
