/** Regression coverage for the account-free local workspace seed graph. */

import { describe, expect, it } from "vitest";
import { convexConfig } from "../../convex/config";
import { LOCAL_ANONYMOUS_AUTH_SUBJECT } from "../../convex/lib/localIdentity";
import { ensureLocalAnonymousWorkspace } from "../../convex/lib/localWorkspaceBootstrap";

const TABLE_NAMES = [
  "users",
  "workspaces",
  "workspace_memberships",
  "chats",
  "chat_branches",
] as const;

type TableName = (typeof TABLE_NAMES)[number];
type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type IndexClause = { field: string; value: unknown };

class TableStore {
  private nextId = 0;
  readonly rows = new Map<string, Row>();

  constructor(private readonly name: TableName) {}

  insert(value: Record<string, unknown>): string {
    const id = `${this.name}_${this.nextId}`;
    this.nextId += 1;
    this.rows.set(id, { ...value, _id: id, _creationTime: this.nextId });
    return id;
  }

  patch(id: string, patch: Record<string, unknown>): void {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`patch: missing row ${id}`);
    const next = { ...existing, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) Reflect.deleteProperty(next, key);
    }
    this.rows.set(id, next);
  }

  all(): Row[] {
    return [...this.rows.values()];
  }
}

function makeMockCtx() {
  const stores = new Map<TableName, TableStore>(
    TABLE_NAMES.map((name) => [name, new TableStore(name)]),
  );

  const storeFor = (table: TableName) => {
    const store = stores.get(table);
    if (!store) throw new Error(`unknown table: ${table}`);
    return store;
  };

  const db = {
    insert: async (table: TableName, value: Record<string, unknown>) =>
      storeFor(table).insert(value),
    get: async (id: string) => {
      for (const store of stores.values()) {
        const row = store.rows.get(id);
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
    query: (table: TableName) => ({
      withIndex(
        indexName: string,
        build: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) {
        const clauses: IndexClause[] = [];
        const queryBuilder = {
          eq(field: string, value: unknown) {
            clauses.push({ field, value });
            return queryBuilder;
          },
        };
        build(queryBuilder);
        let direction: "asc" | "desc" = "asc";
        const sortField =
          indexName === "by_workspace_archived_last_user_message_at"
            ? "lastUserMessageAt"
            : indexName === "by_workspace_updated_at"
              ? "updatedAt"
              : indexName === "by_workspace_chat_created_at" ||
                  indexName === "by_workspace_chat_role_created_at"
                ? "createdAt"
                : "_creationTime";
        const selectedRows = () =>
          storeFor(table)
            .all()
            .filter((row) => clauses.every((clause) => row[clause.field] === clause.value))
            .sort((left, right) => {
              const leftValue = left[sortField] as number;
              const rightValue = right[sortField] as number;
              return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
            });
        const indexQuery = {
          order(nextDirection: "asc" | "desc") {
            direction = nextDirection;
            return indexQuery;
          },
          async first() {
            return selectedRows()[0] ?? null;
          },
          async unique() {
            const rows = selectedRows();
            if (rows.length > 1) throw new Error("query was not unique");
            return rows[0] ?? null;
          },
        };
        return indexQuery;
      },
    }),
  };

  return { db, stores, storeFor };
}

function seedLocalUser(ctx: ReturnType<typeof makeMockCtx>, now = 100): string {
  return ctx.storeFor("users").insert({
    authSubject: LOCAL_ANONYMOUS_AUTH_SUBJECT,
    name: "Local user",
    createdAt: now,
    updatedAt: now,
  });
}

describe("local anonymous workspace bootstrap", () => {
  it("completes the durable workspace graph for an already-seeded local user", async () => {
    expect(LOCAL_ANONYMOUS_AUTH_SUBJECT).toBe("local:monte-carlo");
    const ctx = makeMockCtx();
    const userId = seedLocalUser(ctx);

    const first = await ensureLocalAnonymousWorkspace(ctx as never, 1_000);
    const second = await ensureLocalAnonymousWorkspace(ctx as never, 2_000);

    expect(second).toEqual(first);
    expect(first.userId).toBe(userId);
    for (const table of TABLE_NAMES) {
      expect(ctx.storeFor(table).rows.size, table).toBe(1);
    }

    const bootstrapConfig = convexConfig.dev.localWorkspaceBootstrap;
    const workspace = ctx.storeFor("workspaces").all()[0];
    const membership = ctx.storeFor("workspace_memberships").all()[0];
    const chat = ctx.storeFor("chats").all()[0];
    const rootBranch = ctx.storeFor("chat_branches").all()[0];
    expect(workspace).toMatchObject({
      _id: first.workspaceId,
      publicId: bootstrapConfig.workspacePublicId,
      storageMode: "local",
      createdByUserId: userId,
    });
    expect(membership).toMatchObject({
      publicId: bootstrapConfig.membershipPublicId,
      workspaceId: first.workspaceId,
      userId,
      role: "owner",
      status: "active",
    });
    expect(chat).toMatchObject({
      _id: first.chatId,
      publicId: bootstrapConfig.chatPublicId,
      workspaceId: first.workspaceId,
      rootBranchId: first.rootBranchId,
      rootBranchPublicId: bootstrapConfig.rootBranchPublicId,
      autoTitleStatus: "pending",
    });
    expect(rootBranch).toMatchObject({
      _id: first.rootBranchId,
      publicId: bootstrapConfig.rootBranchPublicId,
      workspaceId: first.workspaceId,
      chatId: first.chatId,
      anchorType: "root",
      contextMessageIds: [],
      depth: 0,
      nextMessageOrdinal: 0,
    });
  });

  it("reuses an existing active workspace and only supplies its missing chat graph", async () => {
    const ctx = makeMockCtx();
    const userId = seedLocalUser(ctx);
    const workspaceId = ctx.storeFor("workspaces").insert({
      publicId: "ws_existing",
      name: "Existing workspace",
      storageMode: "local",
      schemaVersion: 1,
      createdByUserId: userId,
      createdAt: 200,
      updatedAt: 200,
    });
    ctx.storeFor("workspace_memberships").insert({
      publicId: "member_existing",
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: 200,
      updatedAt: 200,
    });

    const result = await ensureLocalAnonymousWorkspace(ctx as never, 1_000);

    expect(result.workspaceId).toBe(workspaceId);
    expect(ctx.storeFor("workspaces").rows.size).toBe(1);
    expect(ctx.storeFor("workspaces").all()[0]?.name).toBe("Existing workspace");
    expect(ctx.storeFor("chats").all()[0]?.workspaceId).toBe(workspaceId);
    expect(ctx.storeFor("chat_branches").all()[0]?.chatId).toBe(result.chatId);
  });
});
