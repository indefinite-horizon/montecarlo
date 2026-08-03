/** Registers Better Auth HTTP routes and health endpoints. */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { devAllowedOrigins, env, isDev } from "./env";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: isDev ? devAllowedOrigins : [env.SITE_URL],
  },
});

http.route({
  path: "/api/health/live",
  method: "GET",
  handler: httpAction(async () => {
    return Response.json({ ok: true, status: "live" as const });
  }),
});

http.route({
  path: "/api/health/ready",
  method: "GET",
  handler: httpAction(async () => {
    return Response.json({ ok: true, status: "ready" as const, mode: "liveness-only" as const });
  }),
});

export default http;
