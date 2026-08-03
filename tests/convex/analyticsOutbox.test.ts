/** Unit tests for analytics outbox lease, claim, retry, and prune behavior. */

import { describe, expect, it } from "vitest";
import {
  claimBatch,
  LOCK_TTL_MS,
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  markFailed,
  markSent,
  prune,
  tryAcquireFlushLease,
} from "../../convex/functions/analyticsOutbox";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type IndexClause = { field: string; op: "lt" | "lte" | "eq"; value: unknown };

class TableStore {
  private nextId = 0;
  rows = new Map<string, Row>();

  constructor(private readonly name: string) {}

  insert(value: Record<string, unknown>): string {
    const id = `${this.name}_${this.nextId}`;
    this.nextId += 1;
    this.rows.set(id, { ...value, _id: id, _creationTime: Date.now() });
    return id;
  }

  get(id: string): Row | undefined {
    return this.rows.get(id);
  }

  patch(id: string, patch: Record<string, unknown>): void {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`patch: missing row ${id}`);
    const merged = { ...existing, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) Reflect.deleteProperty(merged, key);
    }
    this.rows.set(id, merged);
  }

  delete(id: string): void {
    this.rows.delete(id);
  }

  all(): Row[] {
    return [...this.rows.values()];
  }
}

function buildIndexQuery(rows: Row[], clauses: IndexClause[]) {
  let direction: "asc" | "desc" = "asc";
  const sortKey = clauses[0]?.field ?? "_creationTime";
  const filtered = rows.filter((row) =>
    clauses.every((clause) => {
      const value = row[clause.field] as number | string | undefined;
      if (value === undefined) return false;
      if (clause.op === "eq") return value === clause.value;
      if (clause.op === "lt") return (value as number) < (clause.value as number);
      return (value as number) <= (clause.value as number);
    }),
  );
  return {
    order(nextDirection: "asc" | "desc") {
      direction = nextDirection;
      return this;
    },
    take(limit: number) {
      return [...filtered]
        .sort((a, b) => {
          const av = a[sortKey] as number;
          const bv = b[sortKey] as number;
          return direction === "asc" ? av - bv : bv - av;
        })
        .slice(0, limit);
    },
    first() {
      return this.take(1)[0] ?? null;
    },
  };
}

function makeMockCtx() {
  const stores = new Map<string, TableStore>([
    ["app_events_outbox", new TableStore("app_events_outbox")],
    ["app_analytics_flush_state", new TableStore("app_analytics_flush_state")],
  ]);

  const db = {
    insert: async (table: string, value: Record<string, unknown>) => {
      const store = stores.get(table);
      if (!store) throw new Error(`unknown table: ${table}`);
      return store.insert(value);
    },
    get: async (id: string) => {
      for (const store of stores.values()) {
        const row = store.get(id);
        if (row) return row;
      }
      return null;
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      for (const store of stores.values()) {
        if (store.rows.has(id)) {
          store.patch(id, patch);
          return;
        }
      }
      throw new Error(`unknown id: ${id}`);
    },
    delete: async (id: string) => {
      for (const store of stores.values()) {
        if (store.rows.has(id)) {
          store.delete(id);
          return;
        }
      }
    },
    query: (table: string) => {
      const store = stores.get(table);
      if (!store) throw new Error(`unknown table: ${table}`);
      const rows = store.all();
      return {
        withIndex(
          _name: string,
          build: (q: {
            eq: (field: string, value: unknown) => unknown;
            lt: (field: string, value: unknown) => unknown;
            lte: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) {
          const clauses: IndexClause[] = [];
          const q = {
            eq(field: string, value: unknown) {
              clauses.push({ field, op: "eq", value });
              return q;
            },
            lt(field: string, value: unknown) {
              clauses.push({ field, op: "lt", value });
              return q;
            },
            lte(field: string, value: unknown) {
              clauses.push({ field, op: "lte", value });
              return q;
            },
          };
          build(q);
          return buildIndexQuery(rows, clauses);
        },
        first: async () => rows[0] ?? null,
      };
    },
  };

  return { db, stores };
}

function seedOutboxRow(
  ctx: ReturnType<typeof makeMockCtx>,
  overrides: Partial<{
    nextAttemptAt: number;
    lockedUntil: number;
    attempts: number;
    createdAt: number;
    insertId: string;
  }> = {},
): string {
  const store = ctx.stores.get("app_events_outbox");
  if (!store) throw new Error("outbox store missing");
  const now = Date.now();
  return store.insert({
    eventName: "user signed up",
    insertId: overrides.insertId ?? `insert_${now}`,
    distinctId: "users_1",
    properties: { user_id: "users_1" },
    occurredAt: now,
    attempts: overrides.attempts ?? 0,
    nextAttemptAt: overrides.nextAttemptAt ?? now,
    lockedUntil: overrides.lockedUntil,
    createdAt: overrides.createdAt ?? now,
  });
}

describe("analytics outbox", () => {
  it("claims pending rows and stamps a lock", async () => {
    const ctx = makeMockCtx();
    const id = seedOutboxRow(ctx, { nextAttemptAt: 100 });
    const claimed = await claimBatch._handler(ctx as never, { now: 200 });
    expect(claimed.map((row) => row._id)).toEqual([id]);
    expect(ctx.stores.get("app_events_outbox")?.get(id)?.lockedUntil).toBe(200 + LOCK_TTL_MS);
  });

  it("deletes sent rows", async () => {
    const ctx = makeMockCtx();
    const id = seedOutboxRow(ctx);
    await markSent._handler(ctx as never, { ids: [id] });
    expect(ctx.stores.get("app_events_outbox")?.get(id)).toBeUndefined();
  });

  it("backs off failed rows and dead-letters after max attempts", async () => {
    const ctx = makeMockCtx();
    const retryId = seedOutboxRow(ctx, { attempts: 0 });
    const deadId = seedOutboxRow(ctx, { attempts: MAX_ATTEMPTS - 1 });
    await markFailed._handler(ctx as never, {
      failures: [
        { id: retryId, error: "temporary", now: 1_000 },
        { id: deadId, error: "terminal", now: 1_000 },
      ],
    });
    expect(ctx.stores.get("app_events_outbox")?.get(retryId)?.attempts).toBe(1);
    expect(ctx.stores.get("app_events_outbox")?.get(deadId)).toBeUndefined();
  });

  it("prunes rows older than the retention cap", async () => {
    const ctx = makeMockCtx();
    const oldId = seedOutboxRow(ctx, { createdAt: 10 });
    const freshId = seedOutboxRow(ctx, { createdAt: MAX_AGE_MS + 20 });
    const removed = await prune._handler(ctx as never, { now: MAX_AGE_MS + 100 });
    expect(removed).toBe(1);
    expect(ctx.stores.get("app_events_outbox")?.get(oldId)).toBeUndefined();
    expect(ctx.stores.get("app_events_outbox")?.get(freshId)).toBeDefined();
  });

  it("rate limits flush leases", async () => {
    const ctx = makeMockCtx();
    const first = await tryAcquireFlushLease._handler(ctx as never, { now: 1_000 });
    const second = await tryAcquireFlushLease._handler(ctx as never, { now: 1_100 });
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
  });
});
