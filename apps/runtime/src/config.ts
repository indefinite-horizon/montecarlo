/** Loads and validates loopback runtime configuration. */

const oneSecondMs = 1_000;
const oneMiB = 1_024 * 1_024;

export const runtimeDefaults = {
  host: "127.0.0.1",
  port: 43_127,
  maxRequestBytes: 2 * oneMiB,
  maxBlobBytes: 32 * oneMiB,
  providerHealthTimeoutMs: 5 * oneSecondMs,
  processKillGraceMs: oneSecondMs,
  developmentOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
  desktopOrigins: ["app://monte-carlo"],
  openRouterBaseURL: "https://openrouter.ai/api/v1",
  ollamaBaseURL: "http://127.0.0.1:11434/v1",
} as const;

export interface RuntimeConfig {
  host: "127.0.0.1" | "::1";
  port: number;
  development: boolean;
  bearerToken?: string;
  blobAttestationPrivateKey?: string;
  allowedOrigins: ReadonlySet<string>;
  allowedWorkspaceIds?: ReadonlySet<string>;
  maxRequestBytes: number;
  maxBlobBytes: number;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return runtimeDefaults.port;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("MONTE_CARLO_RUNTIME_PORT must be an integer between 0 and 65535.");
  }
  return port;
}

function readHost(raw: string | undefined): RuntimeConfig["host"] {
  const host = raw?.trim() || runtimeDefaults.host;
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("The runtime may only bind to 127.0.0.1 or ::1.");
  }
  return host;
}

function normalizeConfiguredOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (trimmed === "app://monte-carlo") return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid runtime origin: ${trimmed}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`Runtime origins must be exact HTTP(S) origins: ${trimmed}`);
  }
  return url.origin;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const development = env.NODE_ENV === "development" || env.MONTE_CARLO_RUNTIME_DEV === "1";
  const bearerToken = env.MONTE_CARLO_RUNTIME_TOKEN?.trim() || undefined;
  const blobAttestationPrivateKey =
    env.MONTE_CARLO_BLOB_ATTESTATION_PRIVATE_KEY?.trim() || undefined;
  if (!development && (bearerToken === undefined || bearerToken.length < 32)) {
    throw new Error(
      "MONTE_CARLO_RUNTIME_TOKEN must contain at least 32 characters outside development.",
    );
  }

  const configuredOriginValues = env.MONTE_CARLO_RUNTIME_ALLOWED_ORIGINS?.split(",").filter(
    (origin) => origin.trim() !== "",
  );
  const configuredOrigins = configuredOriginValues?.length ? configuredOriginValues : undefined;
  const defaults = development
    ? [...runtimeDefaults.developmentOrigins, ...runtimeDefaults.desktopOrigins]
    : [...runtimeDefaults.desktopOrigins];
  const configuredWorkspaceIdValues = env.MONTE_CARLO_RUNTIME_WORKSPACE_IDS?.split(",")
    .map((workspaceId) => workspaceId.trim())
    .filter(Boolean);
  const configuredWorkspaceIds = configuredWorkspaceIdValues?.length
    ? configuredWorkspaceIdValues
    : undefined;
  if (
    configuredWorkspaceIds?.some(
      (workspaceId) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(workspaceId),
    )
  ) {
    throw new Error("MONTE_CARLO_RUNTIME_WORKSPACE_IDS contains an invalid workspace ID.");
  }

  return {
    host: readHost(env.MONTE_CARLO_RUNTIME_HOST),
    port: readPort(env.MONTE_CARLO_RUNTIME_PORT),
    development,
    bearerToken,
    blobAttestationPrivateKey,
    allowedOrigins: new Set((configuredOrigins ?? defaults).map(normalizeConfiguredOrigin)),
    allowedWorkspaceIds:
      configuredWorkspaceIds === undefined ? undefined : new Set(configuredWorkspaceIds),
    maxRequestBytes: runtimeDefaults.maxRequestBytes,
    maxBlobBytes: runtimeDefaults.maxBlobBytes,
  };
}
