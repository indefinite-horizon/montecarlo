/** Reads the current app user profile. */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

export function useCurrentUser() {
  const me = useQuery(api.auth.me);

  return {
    currentUserId: me?.id ?? null,
    currentUserName: me?.name ?? null,
    currentUserEmail: me?.email ?? null,
    currentUserAvatarUrl: me?.image ?? null,
  };
}
