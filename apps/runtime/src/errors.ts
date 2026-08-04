/** Maps internal failures to bounded, secret-redacted public errors. */

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function toPublicError(error: unknown, secrets: readonly string[] = []): string {
  const source =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "The provider request failed.";
  let message = stripControlCharacters(source);

  for (const secret of secrets) {
    if (secret.length >= 4) message = message.replaceAll(secret, "[redacted]");
  }

  message = message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]+){1,2}\b/g, "[redacted]")
    .slice(0, 500)
    .trim();

  return message || "The provider request failed.";
}

export function sanitizeProcessOutput(value: string): string {
  const withoutAnsi = stripAnsiSequences(value);
  return toPublicError(withoutAnsi).slice(0, 2_000);
}

function stripAnsiSequences(value: string): string {
  let result = "";
  let escapeState: "none" | "started" | "csi" = "none";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (escapeState === "none") {
      if (code === 27) escapeState = "started";
      else result += character;
    } else if (escapeState === "started") {
      escapeState = character === "[" ? "csi" : "none";
    } else if (code >= 64 && code <= 126) {
      escapeState = "none";
    }
  }
  return result;
}

function stripControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "\n" || character === "\r" || character === "\t" || code >= 32) {
      result += character;
    }
  }
  return result;
}
