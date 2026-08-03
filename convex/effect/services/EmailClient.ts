/** Sends transactional email through Resend. */

import { Effect } from "effect";
import { ExternalServiceError } from "../AppError";

export interface EmailClient {
  sendMagicLink(args: {
    apiKey: string;
    from: string;
    email: string;
    subject: string;
    htmlBody: string;
  }): Effect.Effect<void, ExternalServiceError>;
}

function truncateErrorBody(body: string): string {
  return body.length > 200 ? `${body.slice(0, 200)}...` : body;
}

export function makeResendEmailClient(): EmailClient {
  return {
    sendMagicLink(args) {
      return Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${args.apiKey}`,
              },
              body: JSON.stringify({
                from: args.from,
                to: args.email,
                subject: args.subject,
                html: args.htmlBody,
              }),
            }),
          catch: (error) =>
            new ExternalServiceError({
              service: "resend",
              message: error instanceof Error ? error.message : String(error),
            }),
        });

        if (response.ok) return;

        const body = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (error) =>
            new ExternalServiceError({
              service: "resend",
              message: error instanceof Error ? error.message : String(error),
            }),
        });

        return yield* Effect.fail(
          new ExternalServiceError({
            service: "resend",
            message: `Failed to send magic link email: HTTP ${response.status} ${truncateErrorBody(
              body,
            )}`,
          }),
        );
      });
    },
  };
}
