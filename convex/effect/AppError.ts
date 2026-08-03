/** Defines small tagged errors used by template Effect programs. */

import { Data } from "effect";

export class ExternalServiceError extends Data.TaggedError("ExternalServiceError")<{
  service: string;
  message: string;
}> {}

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  message: string;
}> {}

export type AppError = ExternalServiceError | ConfigurationError;

export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    ((error as { _tag?: unknown })._tag === "ExternalServiceError" ||
      (error as { _tag?: unknown })._tag === "ConfigurationError")
  );
}

export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof Error) {
    return new ExternalServiceError({ service: "unknown", message: error.message });
  }
  return new ExternalServiceError({ service: "unknown", message: String(error) });
}

export function formatAppError(error: AppError): string {
  if (error._tag === "ExternalServiceError") {
    return `${error.service}: ${error.message}`;
  }
  return error.message;
}
