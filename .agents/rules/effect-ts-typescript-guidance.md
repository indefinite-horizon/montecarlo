---
description: Use Effect.ts intentionally in TypeScript for typed failures, parsing, and orchestration
globs: "**/*.{ts,tsx}"
alwaysApply: false
---

# Effect.ts guidance for TypeScript

Use `Effect.ts` when it makes the code easier to compose, test, and reason about.

Good fits:
- Multi-step domain workflows where several operations can fail and you want explicit, typed failure handling.
- External IO wrappers such as HTTP clients, SDK adapters, encryption helpers, file access, and background jobs.
- Parse-and-validate boundaries where untyped input needs to become trusted application data.
- Orchestration code that coordinates several services or async steps and benefits from a single program flow.
- Shared backend helpers that need consistent timeout, retry, logging, and error mapping behavior.

Usually not worth it:
- Simple React component state and event handlers.
- Straightforward synchronous helpers with no meaningful failure model.
- Direct Convex `query` and `mutation` handlers when the native transactional model is already the clearest abstraction.

Preferred usage patterns:
1. Model the workflow as an `Effect` program with `Effect.gen(...)` or small composable helpers.
2. Wrap fallible async work with `Effect.tryPromise(...)` and sync work with `Effect.try(...)`.
3. Convert unknown failures into tagged app or domain errors instead of throwing raw strings or generic `Error` objects at the Effect boundary.
4. Keep public boundaries simple. If callers already expect `Promise` or Convex-style errors, run the program at the edge and preserve the existing surface.
5. Keep Effect-heavy code at the orchestration and adapter layers; do not force it into every call site.

Repo-specific guidance:
- Prefer Effect most strongly in backend TypeScript, especially `convex/effect/`, `convex/lib/`, and action-oriented orchestration flows.
- Keep Convex query and mutation code mostly direct unless the logic clearly benefits from extraction into a reusable Effect-backed helper.
- When introducing Effect internally, preserve stable external interfaces where possible.
- In this repo, prefer `Data.TaggedError(...)` for lightweight named domain errors. Reuse `lib/effect/AppError.ts` where possible instead of inventing one-off generic errors.
- If a foreign API throws a plain `Error`, map it immediately into a tagged domain error in the `catch` handler rather than leaking the generic error type through your Effect program.

Typical pattern:

```ts
import { Data, Effect } from "effect";

class ValidationError extends Data.TaggedError("ValidationError")<{
  message: string;
  field?: string;
}> {}

class ExternalServiceError extends Data.TaggedError("ExternalServiceError")<{
  message: string;
  service: string;
  operation?: string;
}> {}

class ParseFailure extends Data.TaggedError("ParseFailure")<{
  message: string;
  source: string;
}> {}

export const loadThing = (id: string) =>
  Effect.gen(function* () {
    if (!id) {
      return yield* Effect.fail(
        new ValidationError({ message: "Missing id", field: "id" }),
      );
    }

    const response = yield* Effect.tryPromise({
      try: () => fetch(`/api/things/${id}`),
      catch: (error) =>
        new ExternalServiceError({
          message: String(error),
          service: "things-api",
          operation: "loadThing fetch",
        }),
    });

    return yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (error) =>
        new ParseFailure({
          message: String(error),
          source: "things-api response",
        }),
    });
  });
```

Why this shape:
- `Data.TaggedError(...)` gives you a named `_tag` for `Effect.catchTag(...)` and `Effect.catchTags(...)`.
- The error payload stays structured instead of burying context inside a free-form string.
- Your program error channel remains a discriminated union of domain failures instead of `unknown | Error`.

Boundary pattern:
- Inside the module: compose with `Effect`.
- At the boundary: run the program once and map failures into the error shape the caller already expects.

Rule of thumb:
- Do not use Effect because a file is TypeScript.
- Use Effect when it reduces ambiguity around failures, parsing, orchestration, or side effects.
