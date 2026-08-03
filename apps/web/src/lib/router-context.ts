/** Defines the router context shape shared across all routes. */

import type { ConvexReactClient } from "convex/react";

type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
  };
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
} | null;

export interface RouterContext {
  session: AuthSession;
  convexClient: ConvexReactClient;
}
