/** Provides production safety checks for Better Auth configuration. */

const PLACEHOLDER_AUTH_SECRETS = new Set([
  "dev-change-me-please-use-a-long-random-secret",
  "ci-better-auth-secret-0123456789abcdef",
]);

export function isUnsafeBetterAuthSecret(secret: string): boolean {
  const normalized = secret.trim();
  return (
    normalized.length < 32 ||
    PLACEHOLDER_AUTH_SECRETS.has(normalized) ||
    /(^|[-_])(change[-_]?me|placeholder|example|secret)([-_]|$)/i.test(normalized)
  );
}

export function assertSafeProductionBetterAuthSecret(secret: string, isDev: boolean): void {
  if (isDev) return;
  if (!isUnsafeBetterAuthSecret(secret)) return;
  throw new Error(
    "BETTER_AUTH_SECRET must be a strong unique secret before running outside local development.",
  );
}
