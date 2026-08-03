/** Integration contract for local magic-link auth defaults. */

import { describe, expect, it } from "vitest";
import { sharedConfig } from "../../lib/config";

describe("dev auth defaults", () => {
  it("documents the local email used by run_local.sh and Playwright", () => {
    expect(sharedConfig.dev.defaultAuthUser.email).toMatch(/@test\.local$/);
    expect(sharedConfig.dev.defaultAuthUser.name).toBeTruthy();
  });
});
