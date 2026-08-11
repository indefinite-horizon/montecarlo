/** Verifies role capabilities remain explicit at the workspace authorization boundary. */

import { describe, expect, it } from "vitest";
import { permissionsForRole } from "../../convex/lib/workspacePermissions";

describe("workspace role permissions", () => {
  it("lets viewers personalize their own chat state without granting content writes", () => {
    expect(permissionsForRole("viewer")).toContain("content:personalize");
    expect(permissionsForRole("viewer")).not.toContain("content:write");
  });

  it.each([
    "owner",
    "admin",
    "member",
  ] as const)("grants %s chat personalization alongside its existing content access", (role) => {
    expect(permissionsForRole(role)).toContain("content:personalize");
  });
});
