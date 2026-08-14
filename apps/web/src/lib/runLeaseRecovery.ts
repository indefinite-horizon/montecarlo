/**
 * Tab-scoped, non-secret run identities used to release orphaned leases after reload.
 * Private lease capabilities stay only in the initiating document's memory.
 */

export const RUN_LEASE_RECOVERY_SESSION_KEY = "monte-carlo:owned-run-leases:v1";

export type OwnedRunLease = Readonly<{
  workspacePublicId: string;
  runPublicId: string;
  leaseExpiresAt: number;
}>;

type SessionStorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type StoredOwnedRunLease = OwnedRunLease & Readonly<{ ownerDocumentId: string; orphaned: boolean }>;

type StoredRunLeases = Readonly<{
  version: 1;
  entries: StoredOwnedRunLease[];
}>;

// A single tab cannot meaningfully execute this many simultaneous model runs.
// The cap also bounds parsing and rewriting if sessionStorage is tampered with.
const MAX_OWNED_RUN_LEASES = 100;
const currentDocumentId = globalThis.crypto?.randomUUID?.() ?? `document-${Date.now()}`;
let currentDocumentIsUnloading = false;

export function runLeaseRecoveryDocumentId(): string {
  return currentDocumentId;
}

function isStoredOwnedRunLease(value: unknown): value is StoredOwnedRunLease {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<StoredOwnedRunLease>;
  return (
    typeof entry.workspacePublicId === "string" &&
    entry.workspacePublicId.length > 0 &&
    typeof entry.runPublicId === "string" &&
    entry.runPublicId.length > 0 &&
    typeof entry.leaseExpiresAt === "number" &&
    Number.isFinite(entry.leaseExpiresAt) &&
    typeof entry.ownerDocumentId === "string" &&
    entry.ownerDocumentId.length > 0 &&
    typeof entry.orphaned === "boolean"
  );
}

function readOwnedRunLeases(storage: SessionStorageLike): StoredOwnedRunLease[] {
  try {
    const serialized = storage.getItem(RUN_LEASE_RECOVERY_SESSION_KEY);
    if (!serialized) return [];
    const parsed = JSON.parse(serialized) as Partial<StoredRunLeases>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    const now = Date.now();
    return parsed.entries
      .filter(isStoredOwnedRunLease)
      .filter((entry) => entry.leaseExpiresAt > now)
      .slice(-MAX_OWNED_RUN_LEASES);
  } catch {
    return [];
  }
}

function writeOwnedRunLeases(storage: SessionStorageLike, entries: StoredOwnedRunLease[]): void {
  try {
    if (entries.length === 0) {
      storage.removeItem(RUN_LEASE_RECOVERY_SESSION_KEY);
      return;
    }
    storage.setItem(
      RUN_LEASE_RECOVERY_SESSION_KEY,
      JSON.stringify({ version: 1, entries: entries.slice(-MAX_OWNED_RUN_LEASES) }),
    );
  } catch {
    // A blocked or full sessionStorage falls back to normal lease expiry.
  }
}

/** Clears a canceled or restored unload and reclaims this document's stored records. */
export function markCurrentDocumentActive(storage?: SessionStorageLike): void {
  currentDocumentIsUnloading = false;
  if (!storage) return;
  writeOwnedRunLeases(
    storage,
    readOwnedRunLeases(storage).map((entry) =>
      entry.ownerDocumentId === currentDocumentId ? { ...entry, orphaned: false } : entry,
    ),
  );
}

function sameRun(
  left: OwnedRunLease,
  right: Pick<OwnedRunLease, "workspacePublicId" | "runPublicId">,
) {
  return (
    left.workspacePublicId === right.workspacePublicId && left.runPublicId === right.runPublicId
  );
}

export function browserSessionStorage(): SessionStorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Upserts the non-secret identity of a run owned by this browser tab. */
export function rememberOwnedRunLease(
  storage: SessionStorageLike | undefined,
  lease: OwnedRunLease,
  ownerDocumentId = currentDocumentId,
): void {
  const orphaned = ownerDocumentId === currentDocumentId && currentDocumentIsUnloading;
  if (!storage || !isStoredOwnedRunLease({ ...lease, ownerDocumentId, orphaned })) return;
  const entries = readOwnedRunLeases(storage).filter((entry) => !sameRun(entry, lease));
  entries.push({ ...lease, ownerDocumentId, orphaned });
  writeOwnedRunLeases(storage, entries);
}

/** Removes a settled run without disturbing concurrently owned sibling runs. */
export function forgetOwnedRunLease(
  storage: SessionStorageLike | undefined,
  lease: Pick<OwnedRunLease, "workspacePublicId" | "runPublicId">,
): void {
  if (!storage) return;
  writeOwnedRunLeases(
    storage,
    readOwnedRunLeases(storage).filter((entry) => !sameRun(entry, lease)),
  );
}

/** Marks this document's live records for takeover by its reload successor. */
export function markOwnedRunLeasesOrphaned(
  storage: SessionStorageLike | undefined,
  ownerDocumentId = currentDocumentId,
): void {
  if (!storage) return;
  if (ownerDocumentId === currentDocumentId) currentDocumentIsUnloading = true;
  writeOwnedRunLeases(
    storage,
    readOwnedRunLeases(storage).map((entry) =>
      entry.ownerDocumentId === ownerDocumentId ? { ...entry, orphaned: true } : entry,
    ),
  );
}

/**
 * Claims only explicit handoffs left by a previous document. A duplicated tab
 * receives unmarked sessionStorage records, so it cannot cancel its source
 * tab's live runs merely because it has a different document identity.
 */
export function claimOrphanedRunLeases(
  storage: SessionStorageLike | undefined,
  ownerDocumentId: string = currentDocumentId,
): OwnedRunLease[] {
  if (!storage) return [];
  const entries = readOwnedRunLeases(storage);
  const orphaned = entries.filter(
    (entry) => entry.orphaned && entry.ownerDocumentId !== ownerDocumentId,
  );
  writeOwnedRunLeases(
    storage,
    entries.filter((entry) => !orphaned.includes(entry)),
  );
  return orphaned.map(
    ({ ownerDocumentId: _ownerDocumentId, orphaned: _orphaned, ...lease }) => lease,
  );
}

/** Restores a failed handoff claim so a later authenticated render can retry it. */
export function restoreOrphanedRunLease(
  storage: SessionStorageLike | undefined,
  lease: OwnedRunLease,
  ownerDocumentId: string,
): void {
  if (!storage || !isStoredOwnedRunLease({ ...lease, ownerDocumentId, orphaned: true })) return;
  const entries = readOwnedRunLeases(storage).filter((entry) => !sameRun(entry, lease));
  entries.push({ ...lease, ownerDocumentId, orphaned: true });
  writeOwnedRunLeases(storage, entries);
}
