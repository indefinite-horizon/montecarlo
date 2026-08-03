/**
 * Shared analytics property sanitizer.
 *
 * Imported by both the Convex backend (`convex/lib/analytics/events.ts`) and
 * the web frontend (`apps/web/src/lib/analytics/events.ts`) so the forbidden-
 * key list and shape rules cannot drift between the two surfaces.
 */

/** Allowed primitive types for analytics property values. Flat only. */
export type AnalyticsPrimitive = string | number | boolean | null;

/** Allowed property values: a primitive or a flat array of primitives. */
export type AnalyticsValue = AnalyticsPrimitive | AnalyticsPrimitive[];

/** Sanitized property bag carried through the outbox. */
export type AnalyticsProperties = Record<string, AnalyticsValue>;

/**
 * Property keys that must never appear in analytics events by name alone
 * (case-insensitive exact match). Keep this list concrete and focused on raw
 * personal identifiers, secrets, request data, and user/authored content. Do
 * not block ordinary product labels like `workspace_name`, `agent_name`, or
 * `workspace_slug` here; those need event-level judgment.
 */
const FORBIDDEN_EXACT_KEYS: ReadonlySet<string> = new Set(
  [
    "access_token",
    "address",
    "api_key",
    "api_token",
    "args",
    "arguments",
    "auth_token",
    "author_email",
    "authorization",
    "authorization_header",
    "bank_account",
    "billing_address",
    "birthdate",
    "body",
    "callback_url",
    "card_number",
    "client_ip",
    "client_secret",
    "completion",
    "content",
    "cookie",
    "cookies",
    "credential",
    "credentials",
    "credit_card",
    "date_of_birth",
    "dob",
    "driver_license",
    "email",
    "env",
    "env_var",
    "env_vars",
    "error_message",
    "error_stack",
    "first_name",
    "full_name",
    "government_id",
    "headers",
    "iban",
    "id_token",
    "input_text",
    "ip_address",
    "last_name",
    "member_email",
    "message",
    "message_content",
    "message_text",
    "mobile_number",
    "national_id",
    "output_text",
    "passport_number",
    "password",
    "payload",
    "phone",
    "phone_number",
    "prompt",
    "prompt_template",
    "prompt_text",
    "raw_body",
    "raw_error",
    "raw_payload",
    "raw_response",
    "raw_result",
    "raw_text",
    "reasoning",
    "reasoning_text",
    "redirect_url",
    "refresh_token",
    "remote_ip",
    "request_body",
    "request_headers",
    "request_url",
    "response_body",
    "response_headers",
    "response_url",
    "secret",
    "set_cookie",
    "shipping_address",
    "social_security_number",
    "ssn",
    "stack",
    "street_address",
    "system_prompt",
    "system_prompt_text",
    "tax_id",
    "token",
    "tool_args",
    "tool_result",
    "trace",
    "trace_text",
    "transcript",
    "url",
    "user_email",
    "user_prompt",
    "user_prompt_text",
    "user_text",
    "webhook_token",
    "webhook_url",
    "x_forwarded_for",
  ].map((k) => k.toLowerCase()),
);

/** Suffix patterns that indicate sensitive raw data regardless of prefix. */
const FORBIDDEN_KEY_SUFFIXES: readonly string[] = [
  "_email",
  "_phone",
  "_phone_number",
  "_password",
  "_secret",
  "_token",
  "_credential",
  "_credentials",
  "_prompt",
  "_content",
  "_body",
  "_payload",
  "_headers",
  "_args",
  "_arguments",
];

const SNAKE_CASE_KEY = /^[a-z][a-z0-9_]*$/;

/**
 * `$feature/<flag-key>` is a *prefix* convention (one property per flag), but
 * `$set` and `$set_once` are exact PostHog operators. Treating the latter as
 * prefixes would let keys like `$setting_url` or `$setup` bypass the
 * forbidden-suffix guard.
 */
function isReservedKey(key: string): boolean {
  if (key.startsWith("$feature/")) return true;
  return key === "$set" || key === "$set_once";
}

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (FORBIDDEN_EXACT_KEYS.has(lower)) return true;
  return FORBIDDEN_KEY_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function isAnalyticsPrimitive(value: unknown): value is AnalyticsPrimitive {
  if (value === null) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

function isAnalyticsValue(value: unknown): value is AnalyticsValue {
  if (isAnalyticsPrimitive(value)) return true;
  if (Array.isArray(value)) return value.every(isAnalyticsPrimitive);
  return false;
}

/**
 * Validate a property key. Throws if the key is misshaped or matches a
 * forbidden exact key or suffix. Reserved PostHog prefixes (e.g.
 * `$feature/<key>`) are accepted.
 */
function assertKeyAllowed(key: string): void {
  if (key.length === 0) {
    throw new Error("Analytics property key must not be empty");
  }
  if (isReservedKey(key)) return;
  if (!SNAKE_CASE_KEY.test(key)) {
    throw new Error(`Analytics property key must be snake_case: '${key}'`);
  }
  if (isForbiddenKey(key)) {
    throw new Error(
      `Analytics property key '${key}' is forbidden for analytics (PII or sensitive content). ` +
        "If this is genuinely safe to log, use a more specific non-sensitive key; otherwise drop it.",
    );
  }
}

/**
 * Type-narrow + sanitize a property bag. Drops `undefined` values. Throws if
 * any key/value is malformed. Rejects nested objects.
 */
export function sanitizeProperties(input: Record<string, unknown>): AnalyticsProperties {
  const out: AnalyticsProperties = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (rawValue === undefined) continue;
    assertKeyAllowed(rawKey);
    if (!isAnalyticsValue(rawValue)) {
      throw new Error(
        `Analytics property '${rawKey}' has an unsupported value type. ` +
          "Only string | number | boolean | null and flat arrays of primitives are allowed.",
      );
    }
    out[rawKey] = rawValue;
  }
  return out;
}
