/** Validates backend environment variables and derives local-dev origins. */

import { cleanEnv, str } from "envalid";
import { computeDevToolsEnabled } from "./lib/devToolsGate";

export const env = cleanEnv(process.env, {
  SITE_URL: str({ desc: "Frontend URL (e.g. http://localhost:5173)" }),
  BETTER_AUTH_SECRET: str({ desc: "Secret for Better Auth session encryption" }),
  CONVEX_URL: str({ desc: "Convex deployment URL.", default: "" }),
  CONVEX_SITE_URL: str({ desc: "Convex HTTP actions site URL.", default: "" }),
  CONVEX_AGENT_MODE: str({ desc: "Convex local agent mode.", default: "" }),
  GOOGLE_CLIENT_ID: str({ desc: "Google OAuth client ID.", default: "" }),
  GOOGLE_CLIENT_SECRET: str({ desc: "Google OAuth client secret.", default: "" }),
  RESEND_API_KEY: str({ desc: "Resend API key for transactional email.", default: "" }),
  RESEND_FROM_EMAIL: str({
    desc: "Verified Resend sender address for transactional email.",
    default: "onboarding@resend.dev",
  }),
  POSTHOG_PROJECT_TOKEN: str({ desc: "PostHog project token.", default: "" }),
  POSTHOG_HOST: str({
    desc: "PostHog ingestion host.",
    default: "https://us.i.posthog.com",
  }),
  ANALYTICS_DISABLED: str({ desc: "Hard kill switch for analytics.", default: "" }),
  ENABLE_DANGEROUS_DEV_TOOLS: str({
    desc: "Explicit opt-in for destructive local dev tools. Must be 'true' to enable.",
    default: "",
  }),
  GIT_SHA: str({ desc: "Commit SHA stamped on structured logs.", default: "" }),
  APP_RELEASE_CHANNEL: str({ desc: "Deployment channel.", default: "" }),
});

export const isDev =
  env.SITE_URL.startsWith("http://localhost") ||
  env.SITE_URL.startsWith("http://127.0.0.1") ||
  env.CONVEX_AGENT_MODE === "anonymous" ||
  env.APP_RELEASE_CHANNEL === "development";

export const isLocalDev =
  env.SITE_URL.startsWith("http://localhost") || env.SITE_URL.startsWith("http://127.0.0.1");

export const devToolsEnabled = computeDevToolsEnabled(env.SITE_URL, env.ENABLE_DANGEROUS_DEV_TOOLS);

const devOriginPorts = Array.from({ length: 50 }, (_, index) => 5173 + index);

export const devAllowedOrigins = [
  ...devOriginPorts.map((port) => `http://localhost:${port}`),
  ...devOriginPorts.map((port) => `http://127.0.0.1:${port}`),
  "http://localhost:3211",
  "http://127.0.0.1:3211",
];
