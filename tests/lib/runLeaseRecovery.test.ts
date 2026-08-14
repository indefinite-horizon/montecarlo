/** Verifies tab-scoped run lease recovery storage. */

import { describe, expect, it } from "vitest";
import {
  claimOrphanedRunLeases,
  forgetOwnedRunLease,
  markCurrentDocumentActive,
  markOwnedRunLeasesOrphaned,
  type OwnedRunLease,
  RUN_LEASE_RECOVERY_SESSION_KEY,
  rememberOwnedRunLease,
  restoreOrphanedRunLease,
} from "../../apps/web/src/lib/runLeaseRecovery";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(RUN_LEASE_RECOVERY_SESSION_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function lease(overrides: Partial<OwnedRunLease> = {}): OwnedRunLease {
  return {
    workspacePublicId: "ws-a",
    runPublicId: "run-a",
    leaseExpiresAt: Date.now() + 20_000,
    ...overrides,
  };
}

describe("run lease reload recovery", () => {
  it("claims only the previous document's snapshot", () => {
    const storage = memoryStorage();
    const first = lease();
    const sibling = lease({ runPublicId: "run-b" });
    rememberOwnedRunLease(storage, first, "previous-document");
    rememberOwnedRunLease(storage, sibling, "previous-document");
    markOwnedRunLeasesOrphaned(storage, "previous-document");

    expect(claimOrphanedRunLeases(storage, "current-document")).toEqual([first, sibling]);
    expect(claimOrphanedRunLeases(storage, "current-document")).toEqual([]);

    const currentDocumentRun = lease({ runPublicId: "run-c" });
    rememberOwnedRunLease(storage, currentDocumentRun, "current-document");
    expect(claimOrphanedRunLeases(storage, "current-document")).toEqual([]);
    markOwnedRunLeasesOrphaned(storage, "current-document");
    expect(claimOrphanedRunLeases(storage, "next-document")).toEqual([currentDocumentRun]);
  });

  it("does not claim sessionStorage copied into a duplicated tab", () => {
    const storage = memoryStorage();
    const sourceTabRun = lease();
    rememberOwnedRunLease(storage, sourceTabRun, "source-document");

    expect(claimOrphanedRunLeases(storage, "duplicated-document")).toEqual([]);
    markOwnedRunLeasesOrphaned(storage, "duplicated-document");
    expect(claimOrphanedRunLeases(storage, "next-duplicate-document")).toEqual([]);
  });

  it("refreshes one lease and forgets it without disturbing siblings", () => {
    const storage = memoryStorage();
    const first = lease();
    const sibling = lease({ runPublicId: "run-b" });
    rememberOwnedRunLease(storage, first, "previous-document");
    rememberOwnedRunLease(storage, sibling, "previous-document");
    rememberOwnedRunLease(
      storage,
      { ...first, leaseExpiresAt: Date.now() + 40_000 },
      "previous-document",
    );
    forgetOwnedRunLease(storage, first);
    markOwnedRunLeasesOrphaned(storage, "previous-document");

    expect(claimOrphanedRunLeases(storage, "current-document")).toEqual([sibling]);
  });

  it("restores a failed claim for a later recovery attempt", () => {
    const storage = memoryStorage();
    const interrupted = lease();
    rememberOwnedRunLease(storage, interrupted, "previous-document");
    markOwnedRunLeasesOrphaned(storage, "previous-document");

    expect(claimOrphanedRunLeases(storage, "current-document")).toEqual([interrupted]);
    restoreOrphanedRunLease(storage, interrupted, "retry-document");
    expect(claimOrphanedRunLeases(storage, "next-document")).toEqual([interrupted]);
  });

  it("resets the current document's unload state after a pageshow", () => {
    const storage = memoryStorage();
    const resumed = lease({ runPublicId: "run-after-pageshow" });
    rememberOwnedRunLease(storage, resumed);
    markOwnedRunLeasesOrphaned(storage);
    markCurrentDocumentActive(storage);

    expect(claimOrphanedRunLeases(storage, "different-document")).toEqual([]);
  });

  it("drops malformed records and tolerates unavailable storage", () => {
    const storage = memoryStorage(
      JSON.stringify({
        version: 1,
        entries: [
          { ...lease(), ownerDocumentId: "previous-document", orphaned: true },
          {
            ...lease({ runPublicId: 42 as never }),
            ownerDocumentId: "previous-document",
            orphaned: true,
          },
        ],
      }),
    );
    expect(claimOrphanedRunLeases(storage, "current-document")).toEqual([lease()]);

    const blockedStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => rememberOwnedRunLease(blockedStorage, lease())).not.toThrow();
    expect(() => forgetOwnedRunLease(blockedStorage, lease())).not.toThrow();
    expect(() => markOwnedRunLeasesOrphaned(blockedStorage)).not.toThrow();
    expect(claimOrphanedRunLeases(blockedStorage)).toEqual([]);
  });
});
