/** Strip sensitive search params from PostHog URL-bearing properties. */

const SENSITIVE_PARAM_NAMES: ReadonlySet<string> = new Set([
  "code",
  "state",
  "verify",
  "token",
  "magic",
  "access_token",
  "id_token",
  "refresh_token",
]);

const URL_BEARING_KEYS: readonly string[] = [
  "$current_url",
  "$pathname",
  "$initial_current_url",
  "$initial_pathname",
  "$referrer",
  "$initial_referrer",
];

const PLACEHOLDER_BASE = "https://__template.local__";

function scrubUrlString(raw: string): string {
  let parsed: URL;
  let absolute = true;
  try {
    parsed = new URL(raw);
  } catch {
    try {
      parsed = new URL(raw, PLACEHOLDER_BASE);
      absolute = false;
    } catch {
      return raw;
    }
  }

  let mutated = false;
  for (const param of SENSITIVE_PARAM_NAMES) {
    if (parsed.searchParams.has(param)) {
      parsed.searchParams.delete(param);
      mutated = true;
    }
  }
  if (!mutated) return raw;

  if (absolute) return parsed.toString();
  const search = parsed.searchParams.toString();
  const path = parsed.pathname + (search ? `?${search}` : "") + parsed.hash;
  return path;
}

/**
 * Walk the well-known PostHog URL-bearing property keys and remove any
 * sensitive query parameters before the event is sent to the provider.
 * Non-URL values pass through unchanged.
 */
export function scrubSensitiveUrlParams(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of URL_BEARING_KEYS) {
    const value = properties[key];
    if (typeof value !== "string") continue;
    const scrubbed = scrubUrlString(value);
    if (scrubbed !== value) {
      properties[key] = scrubbed;
    }
  }
  return properties;
}
