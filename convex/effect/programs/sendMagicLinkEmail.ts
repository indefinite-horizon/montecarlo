/** Validates and sends production magic-link authentication email. */

import { Effect } from "effect";
import { ConfigurationError } from "../AppError";
import type { EmailClient } from "../services/EmailClient";

export function sendMagicLinkEmail(
  client: EmailClient,
  args: {
    resendApiKey: string;
    resendFromEmail: string;
    email: string;
    appName: string;
    htmlBody: string;
  },
) {
  return Effect.gen(function* () {
    if (!args.resendApiKey) {
      return yield* Effect.fail(
        new ConfigurationError({
          message: "RESEND_API_KEY is required in production to send magic link emails",
        }),
      );
    }
    if (!args.resendFromEmail) {
      return yield* Effect.fail(
        new ConfigurationError({
          message: "RESEND_FROM_EMAIL is required in production to send magic link emails",
        }),
      );
    }

    yield* client.sendMagicLink({
      apiKey: args.resendApiKey,
      from: args.resendFromEmail,
      email: args.email,
      subject: `Sign in to ${args.appName}`,
      htmlBody: args.htmlBody,
    });
  });
}
