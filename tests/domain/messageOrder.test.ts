/** Verifies deterministic ordering when rebuilding chat completion metadata. */

import { describe, expect, it } from "vitest";
import { selectLatestStandaloneMessage } from "../../convex/lib/messageOrder";

describe("selectLatestStandaloneMessage", () => {
  const user = { role: "user", createdAt: 100, _creationTime: 10 } as const;

  it("returns the newer system message", () => {
    const system = { role: "system", createdAt: 101, _creationTime: 11 } as const;
    expect(selectLatestStandaloneMessage(user, system)).toBe(system);
  });

  it("uses Convex creation order to break equal application timestamps", () => {
    const system = { role: "system", createdAt: 100, _creationTime: 11 } as const;
    expect(selectLatestStandaloneMessage(user, system)).toBe(system);
  });

  it("returns the available message when the other role is absent", () => {
    expect(selectLatestStandaloneMessage(user, null)).toBe(user);
    expect(selectLatestStandaloneMessage(null, null)).toBeUndefined();
  });
});
