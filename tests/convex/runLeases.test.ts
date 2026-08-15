/** Unit coverage for transactional branch-scoped run lease ownership. */

import { describe, expect, it } from "vitest";
import { convexConfig } from "../../convex/config";
import {
  createRunLeaseCapability,
  hasActiveRunOnBranch,
  hasRunLeaseCapability,
  nextRunLeaseExpiresAt,
  RUN_LEASE_EXPIRED_CODE,
  RUN_LEASE_EXPIRED_MESSAGE,
  RUN_NO_LONGER_ACTIVE_CODE,
  runNoLongerActiveError,
  settleStaleBranchLease,
} from "../../convex/lib/runLeases";

type Row = Record<string, unknown> & { _id: string };

function makeBranch(overrides: Record<string, unknown> = {}): Row {
  return {
    _id: "branch_1",
    workspaceId: "workspace_1",
    chatId: "chat_1",
    activeRunId: "run_1",
    activeRunLeaseExpiresAt: 2_000,
    ...overrides,
  };
}

function makeRun(overrides: Record<string, unknown> = {}): Row {
  return {
    _id: "run_1",
    workspaceId: "workspace_1",
    chatId: "chat_1",
    branchId: "branch_1",
    status: "running",
    ...overrides,
  };
}

function makeMockCtx(rows: Row[]) {
  const documents = new Map(rows.map((row) => [row._id, { ...row }]));
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  let queryCount = 0;

  const db = {
    get: async (id: string) => documents.get(id) ?? null,
    patch: async (id: string, value: Record<string, unknown>) => {
      const current = documents.get(id);
      if (!current) throw new Error(`patch: missing row ${id}`);
      const updated = { ...current, ...value };
      for (const [field, fieldValue] of Object.entries(value)) {
        if (fieldValue === undefined) Reflect.deleteProperty(updated, field);
      }
      documents.set(id, updated);
      patches.push({ id, value });
    },
    query: (table: string) => {
      if (table !== "agent_runs") throw new Error(`unknown table: ${table}`);
      queryCount += 1;
      return {
        withIndex(
          _indexName: string,
          build: (query: {
            eq: (field: string, value: unknown) => unknown;
            gt: (field: string, value: unknown) => unknown;
            lte: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) {
          const clauses: Array<{
            operator: "eq" | "gt" | "lte";
            field: string;
            value: unknown;
          }> = [];
          const query = {
            eq(field: string, value: unknown) {
              clauses.push({ operator: "eq" as const, field, value });
              return query;
            },
            gt(field: string, value: unknown) {
              clauses.push({ operator: "gt" as const, field, value });
              return query;
            },
            lte(field: string, value: unknown) {
              clauses.push({ operator: "lte" as const, field, value });
              return query;
            },
          };
          build(query);
          const matchingRuns = () =>
            [...documents.values()].filter(
              (row) =>
                row.branchId !== undefined &&
                row.status !== undefined &&
                clauses.every(({ operator, field, value }) => {
                  if (operator === "eq") return row[field] === value;
                  if (operator === "gt") return (row[field] as number) > (value as number);
                  return (row[field] as number) <= (value as number);
                }),
            );
          let direction: "asc" | "desc" = "asc";
          const indexedQuery = {
            order(nextDirection: "asc" | "desc") {
              direction = nextDirection;
              return indexedQuery;
            },
            async take(limit: number) {
              const ordered = matchingRuns().sort((left, right) => {
                const leftUpdatedAt = (left.updatedAt as number | undefined) ?? 0;
                const rightUpdatedAt = (right.updatedAt as number | undefined) ?? 0;
                return direction === "asc"
                  ? leftUpdatedAt - rightUpdatedAt
                  : rightUpdatedAt - leftUpdatedAt;
              });
              return ordered.slice(0, limit);
            },
            async first() {
              return matchingRuns()[0] ?? null;
            },
          };
          return indexedQuery;
        },
      };
    },
  };

  return {
    ctx: { db },
    documents,
    patches,
    get queryCount() {
      return queryCount;
    },
  };
}

describe("branch run leases", () => {
  it("keeps a valid live owner attached", async () => {
    const branch = makeBranch();
    const mock = makeMockCtx([branch, makeRun()]);

    await expect(settleStaleBranchLease(mock.ctx as never, branch as never, 1_000)).resolves.toBe(
      true,
    );
    expect(mock.patches).toEqual([]);
    expect(mock.documents.get("branch_1")).toMatchObject({
      activeRunId: "run_1",
      activeRunLeaseExpiresAt: 2_000,
    });
  });

  it("cancels an expired running owner and detaches it", async () => {
    const now = 2_000;
    const branch = makeBranch({ activeRunLeaseExpiresAt: now });
    const mock = makeMockCtx([branch, makeRun()]);

    await expect(settleStaleBranchLease(mock.ctx as never, branch as never, now)).resolves.toBe(
      false,
    );
    expect(mock.documents.get("run_1")).toMatchObject({
      status: "canceled",
      errorCode: RUN_LEASE_EXPIRED_CODE,
      errorMessage: RUN_LEASE_EXPIRED_MESSAGE,
      completedAt: now,
      updatedAt: now,
    });
    expect(mock.documents.get("branch_1")).not.toHaveProperty("activeRunId");
    expect(mock.documents.get("branch_1")).not.toHaveProperty("activeRunLeaseExpiresAt");
    expect(mock.patches.map(({ id }) => id)).toEqual(["run_1", "branch_1"]);
  });

  it.each([
    ["terminal", makeRun({ status: "succeeded" })],
    ["missing", undefined],
    ["mismatched", makeRun({ branchId: "branch_2" })],
  ])("detaches a %s owner without rewriting the referenced run", async (_case, run) => {
    const branch = makeBranch();
    const mock = makeMockCtx(run ? [branch, run] : [branch]);

    await expect(settleStaleBranchLease(mock.ctx as never, branch as never, 1_000)).resolves.toBe(
      false,
    );
    expect(mock.documents.get("branch_1")).not.toHaveProperty("activeRunId");
    expect(mock.documents.get("branch_1")).not.toHaveProperty("activeRunLeaseExpiresAt");
    expect(mock.patches).toEqual([
      {
        id: "branch_1",
        value: {
          runLeaseVersion: 1,
          activeRunId: undefined,
          activeRunLeaseExpiresAt: undefined,
        },
      },
    ]);
  });

  it("does not let a live lease on one branch block its sibling", async () => {
    const branchA = makeBranch({ _id: "branch_a", activeRunId: "run_a" });
    const branchB = makeBranch({
      _id: "branch_b",
      runLeaseVersion: 1,
      activeRunId: undefined,
      activeRunLeaseExpiresAt: undefined,
    });
    const runA = makeRun({ _id: "run_a", branchId: "branch_a" });
    const mock = makeMockCtx([branchA, branchB, runA]);

    await expect(hasActiveRunOnBranch(mock.ctx as never, branchA as never, 1_000)).resolves.toBe(
      true,
    );
    await expect(hasActiveRunOnBranch(mock.ctx as never, branchB as never, 1_000)).resolves.toBe(
      false,
    );
  });

  it("lets a legacy pointerless run block only its exact branch", async () => {
    const branchA = makeBranch({
      _id: "branch_a",
      activeRunId: undefined,
      activeRunLeaseExpiresAt: undefined,
    });
    const branchB = makeBranch({
      _id: "branch_b",
      activeRunId: undefined,
      activeRunLeaseExpiresAt: undefined,
    });
    const legacyRun = makeRun({
      _id: "run_legacy",
      branchId: "branch_a",
      updatedAt: 1_000,
    });
    const mock = makeMockCtx([branchA, branchB, legacyRun]);

    await expect(hasActiveRunOnBranch(mock.ctx as never, branchA as never, 2_000)).resolves.toBe(
      true,
    );
    await expect(hasActiveRunOnBranch(mock.ctx as never, branchB as never, 2_000)).resolves.toBe(
      false,
    );
  });

  it("cancels abandoned legacy runs and permanently migrates the branch", async () => {
    const now = convexConfig.domain.runs.legacyRunStaleAfterMs + 10_000;
    const branch = makeBranch({
      activeRunId: undefined,
      activeRunLeaseExpiresAt: undefined,
    });
    const legacyRun = makeRun({ updatedAt: 1_000 });
    const mock = makeMockCtx([branch, legacyRun]);

    await expect(hasActiveRunOnBranch(mock.ctx as never, branch as never, now)).resolves.toBe(
      false,
    );
    expect(mock.documents.get("run_1")).toMatchObject({
      status: "canceled",
      errorCode: RUN_LEASE_EXPIRED_CODE,
    });
    expect(mock.documents.get("branch_1")).toMatchObject({ runLeaseVersion: 1 });

    const migratedBranch = mock.documents.get("branch_1");
    await expect(
      hasActiveRunOnBranch(mock.ctx as never, migratedBranch as never, now + 1),
    ).resolves.toBe(false);
    expect(mock.queryCount).toBe(2);
  });

  it("does not mark a legacy branch migrated when stale runs exceed the safe batch", async () => {
    const now = convexConfig.domain.runs.legacyRunStaleAfterMs + 10_000;
    const branch = makeBranch({
      activeRunId: undefined,
      activeRunLeaseExpiresAt: undefined,
    });
    const legacyRuns = Array.from(
      { length: convexConfig.domain.runs.legacyMigrationBatchSize + 1 },
      (_, index) =>
        makeRun({
          _id: `run_${index}`,
          updatedAt: 1_000 + index,
        }),
    );
    const mock = makeMockCtx([branch, ...legacyRuns]);

    await expect(hasActiveRunOnBranch(mock.ctx as never, branch as never, now)).rejects.toThrow(
      "Too many abandoned runs exist to migrate this branch safely.",
    );
    expect(mock.documents.get("branch_1")).not.toHaveProperty("runLeaseVersion");
    expect(legacyRuns.every(({ _id }) => mock.documents.get(_id)?.status === "running")).toBe(true);
  });

  it("cleans an orphaned expiry without treating it as an active run", async () => {
    const branch = makeBranch({ activeRunId: undefined });
    const mock = makeMockCtx([branch]);

    await expect(hasActiveRunOnBranch(mock.ctx as never, branch as never, 1_000)).resolves.toBe(
      false,
    );
    expect(mock.documents.get("branch_1")).not.toHaveProperty("activeRunLeaseExpiresAt");
    expect(mock.patches).toEqual([
      {
        id: "branch_1",
        value: { runLeaseVersion: 1, activeRunLeaseExpiresAt: undefined },
      },
    ]);
    expect(mock.queryCount).toBe(0);
  });

  it("computes the next expiry from the configured lease TTL", () => {
    const now = 42_000;

    expect(nextRunLeaseExpiresAt(now)).toBe(now + convexConfig.domain.runs.leaseTtlMs);
  });

  it("stores only a capability digest and rejects a different capability", async () => {
    const lease = await createRunLeaseCapability();
    const run = makeRun({ leaseCapabilityHash: lease.hash });

    expect(lease.capability).toMatch(/^[a-f0-9]{64}$/);
    expect(lease.hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(hasRunLeaseCapability(run as never, lease.capability)).resolves.toBe(true);
    await expect(hasRunLeaseCapability(run as never, "0".repeat(64))).resolves.toBe(false);
  });

  it("returns a stable structured code when lease ownership is lost", () => {
    expect(runNoLongerActiveError().data).toMatchObject({
      code: RUN_NO_LONGER_ACTIVE_CODE,
    });
  });
});
