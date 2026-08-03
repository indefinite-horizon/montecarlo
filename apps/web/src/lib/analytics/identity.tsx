/** Bridges Convex user state into PostHog identify calls. */

// lint-allow: no-direct-use-effect — fire imperative SDK calls when remote auth state resolves.
import { useEffect, useRef } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { sanitizeProperties } from "../../../../../lib/analytics/sanitize";
import { useAnalyticsAdapter } from "./context";

export function AnalyticsIdentityBridge() {
  const adapter = useAnalyticsAdapter();
  const { currentUserId } = useCurrentUser();
  const lastUserIdRef = useRef<string | null>(null);

  // lint-allow: no-direct-use-effect — identify must follow remote auth state.
  useEffect(() => {
    if (!currentUserId) return;
    const userIdStr = String(currentUserId);
    if (lastUserIdRef.current === userIdStr) return;
    adapter.identify(userIdStr, sanitizeProperties({ user_id: userIdStr }));
    lastUserIdRef.current = userIdStr;
  }, [adapter, currentUserId]);

  return null;
}
