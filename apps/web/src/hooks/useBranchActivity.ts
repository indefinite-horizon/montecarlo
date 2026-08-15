/** Tracks durable and local branch-scoped generation activity. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatBranch } from "@/lib/conversation";

export function useBranchActivity(branches: readonly ChatBranch[]) {
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const [locallyRunningBranchIds, setLocallyRunningBranchIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [activityNow, setActivityNow] = useState(Date.now);
  const nextLeaseExpiry = useMemo(
    () =>
      branches.reduce<number | undefined>((next, branch) => {
        const expiry = branch.activeRunLeaseExpiresAt;
        if (expiry === undefined || expiry <= activityNow) return next;
        return next === undefined || expiry < next ? expiry : next;
      }, undefined),
    [activityNow, branches],
  );

  // Convex lease timestamps do not emit an event when they expire.
  useEffect(() => {
    if (nextLeaseExpiry === undefined) return;
    const timer = window.setTimeout(
      () => setActivityNow(Date.now()),
      Math.max(0, nextLeaseExpiry - Date.now() + 1),
    );
    return () => window.clearTimeout(timer);
  }, [nextLeaseExpiry]);

  // lint-allow: no-direct-use-effect — detached turns must release their runtime requests.
  useEffect(
    () => () => {
      for (const controller of abortControllersRef.current.values()) controller.abort();
      abortControllersRef.current.clear();
    },
    [],
  );

  const claim = useCallback((branchId: string): AbortController | null => {
    if (abortControllersRef.current.has(branchId)) return null;
    const controller = new AbortController();
    abortControllersRef.current.set(branchId, controller);
    setLocallyRunningBranchIds((current) => new Set(current).add(branchId));
    return controller;
  }, []);

  const release = useCallback((branchId: string, controller: AbortController) => {
    if (abortControllersRef.current.get(branchId) !== controller) return;
    abortControllersRef.current.delete(branchId);
    setLocallyRunningBranchIds((current) => {
      if (!current.has(branchId)) return current;
      const next = new Set(current);
      next.delete(branchId);
      return next;
    });
  }, []);

  const isLocallyRunning = useCallback(
    (branchId: string) => locallyRunningBranchIds.has(branchId),
    [locallyRunningBranchIds],
  );
  const stop = useCallback(
    (branchId: string) => abortControllersRef.current.get(branchId)?.abort(),
    [],
  );

  return useMemo(
    () => ({ activityNow, claim, isLocallyRunning, release, stop }),
    [activityNow, claim, isLocallyRunning, release, stop],
  );
}
