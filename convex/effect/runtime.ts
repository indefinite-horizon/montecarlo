/** Runs Effect programs and converts tagged failures back to thrown errors. */

import { Cause, Effect, Exit } from "effect";
import { type AppError, toAppError } from "./AppError";

function extractAppError(cause: Cause.Cause<AppError>): AppError {
  const failure = Cause.failureOption(cause);
  if (failure._tag === "Some") return toAppError(failure.value);
  return toAppError(Cause.squash(cause));
}

export async function runPromiseEffect<T>(program: Effect.Effect<T, AppError, never>) {
  const exit = await Effect.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return exit.value;
  throw extractAppError(exit.cause);
}
