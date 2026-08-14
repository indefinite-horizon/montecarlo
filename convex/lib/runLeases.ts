/** Transactional ownership helpers for branch-scoped model runs. */

import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { convexConfig } from "../config";

export const ACTIVE_BRANCH_RUN_ERROR = "A response is already running on this branch.";
export const RUN_NO_LONGER_ACTIVE_ERROR = "Run is no longer active on this branch.";
export const RUN_NO_LONGER_ACTIVE_CODE = "run_no_longer_active";
export const RUN_LEASE_EXPIRED_CODE = "run_lease_expired";
export const RUN_LEASE_EXPIRED_MESSAGE = "Run lease expired before completion.";
export const RUN_LEASE_CANCELED_CODE = "run_canceled";
export const RUN_LEASE_CANCELED_MESSAGE = "Run canceled by its owner.";
export const RUN_LEASE_VERSION = 1;

export function runNoLongerActiveError(): ConvexError<{
  code: typeof RUN_NO_LONGER_ACTIVE_CODE;
  message: typeof RUN_NO_LONGER_ACTIVE_ERROR;
}> {
  return new ConvexError({
    code: RUN_NO_LONGER_ACTIVE_CODE,
    message: RUN_NO_LONGER_ACTIVE_ERROR,
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const input = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}

export async function createRunLeaseCapability(): Promise<{
  capability: string;
  hash: string;
}> {
  const capability = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  return { capability, hash: await sha256Hex(capability) };
}

export async function hasRunLeaseCapability(
  run: Doc<"agent_runs">,
  capability: string | undefined,
): Promise<boolean> {
  return (
    run.leaseCapabilityHash === undefined ||
    (capability !== undefined &&
      constantTimeEqual(await sha256Hex(capability), run.leaseCapabilityHash))
  );
}

export async function requireRunLeaseCapability(
  run: Doc<"agent_runs">,
  capability: string | undefined,
): Promise<void> {
  if (!(await hasRunLeaseCapability(run, capability))) {
    throw runNoLongerActiveError();
  }
}

export function nextRunLeaseExpiresAt(now: number): number {
  return now + convexConfig.domain.runs.leaseTtlMs;
}

function runMatchesBranch(run: Doc<"agent_runs">, branch: Doc<"chat_branches">): boolean {
  return (
    run.workspaceId === branch.workspaceId &&
    run.chatId === branch.chatId &&
    run.branchId === branch._id
  );
}

/**
 * Returns true only for a valid, unexpired owner. Stale owners are canceled and
 * detached in the caller's transaction so a new run can claim the branch.
 */
export async function settleStaleBranchLease(
  ctx: MutationCtx,
  branch: Doc<"chat_branches">,
  now: number,
): Promise<boolean> {
  if (!branch.activeRunId) {
    if (branch.activeRunLeaseExpiresAt !== undefined) {
      await ctx.db.patch(branch._id, {
        runLeaseVersion: RUN_LEASE_VERSION,
        activeRunLeaseExpiresAt: undefined,
      });
    }
    return false;
  }

  const activeRun = await ctx.db.get(branch.activeRunId);
  const validRunningOwner =
    activeRun !== null && runMatchesBranch(activeRun, branch) && activeRun.status === "running";
  if (
    validRunningOwner &&
    branch.activeRunLeaseExpiresAt !== undefined &&
    branch.activeRunLeaseExpiresAt > now
  ) {
    return true;
  }

  if (validRunningOwner) {
    await ctx.db.patch(activeRun._id, {
      status: "canceled",
      errorCode: RUN_LEASE_EXPIRED_CODE,
      errorMessage: RUN_LEASE_EXPIRED_MESSAGE,
      completedAt: now,
      updatedAt: now,
    });
  }
  await ctx.db.patch(branch._id, {
    runLeaseVersion: RUN_LEASE_VERSION,
    activeRunId: undefined,
    activeRunLeaseExpiresAt: undefined,
  });
  return false;
}

/** Guards legacy rows that predate the branch pointer without weakening exact-branch ownership. */
export async function hasActiveRunOnBranch(
  ctx: MutationCtx,
  branch: Doc<"chat_branches">,
  now: number,
): Promise<boolean> {
  if (await settleStaleBranchLease(ctx, branch, now)) return true;
  if (
    branch.runLeaseVersion === RUN_LEASE_VERSION ||
    (branch.activeRunId === undefined && branch.activeRunLeaseExpiresAt !== undefined)
  ) {
    return false;
  }

  const cutoff = now - convexConfig.domain.runs.legacyRunStaleAfterMs;
  const liveLegacyRun = await ctx.db
    .query("agent_runs")
    .withIndex("by_workspace_branch_status_updated_at", (index) =>
      index
        .eq("workspaceId", branch.workspaceId)
        .eq("branchId", branch._id)
        .eq("status", "running")
        .gt("updatedAt", cutoff),
    )
    .first();
  if (liveLegacyRun) return true;

  const staleLegacyRuns = await ctx.db
    .query("agent_runs")
    .withIndex("by_workspace_branch_status_updated_at", (index) =>
      index
        .eq("workspaceId", branch.workspaceId)
        .eq("branchId", branch._id)
        .eq("status", "running")
        .lte("updatedAt", cutoff),
    )
    .order("desc")
    .take(convexConfig.domain.runs.legacyMigrationBatchSize + 1);
  if (staleLegacyRuns.length > convexConfig.domain.runs.legacyMigrationBatchSize) {
    throw new Error("Too many abandoned runs exist to migrate this branch safely.");
  }
  for (const staleRun of staleLegacyRuns) {
    await ctx.db.patch(staleRun._id, {
      status: "canceled",
      errorCode: RUN_LEASE_EXPIRED_CODE,
      errorMessage: RUN_LEASE_EXPIRED_MESSAGE,
      completedAt: now,
      updatedAt: now,
    });
  }

  await ctx.db.patch(branch._id, { runLeaseVersion: RUN_LEASE_VERSION });
  return false;
}
