/** Unit tests for magic-link email delivery helpers. */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigurationError, ExternalServiceError } from "../../convex/effect/AppError";
import { sendMagicLinkEmail } from "../../convex/effect/programs/sendMagicLinkEmail";
import { runPromiseEffect } from "../../convex/effect/runtime";
import type { EmailClient } from "../../convex/effect/services/EmailClient";
import { magicLinkEmail } from "../../convex/emails/magicLink";

describe("sendMagicLinkEmail", () => {
  it("requires Resend configuration", async () => {
    const client: EmailClient = {
      sendMagicLink: () => Effect.void,
    };

    await expect(
      runPromiseEffect(
        sendMagicLinkEmail(client, {
          resendApiKey: "",
          resendFromEmail: "Template <login@example.com>",
          email: "user@test.local",
          appName: "Template",
          htmlBody: "<p>body</p>",
        }),
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);

    await expect(
      runPromiseEffect(
        sendMagicLinkEmail(client, {
          resendApiKey: "test-resend-key",
          resendFromEmail: "",
          email: "user@test.local",
          appName: "Template",
          htmlBody: "<p>body</p>",
        }),
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("sends through the provided email client", async () => {
    const calls: Parameters<EmailClient["sendMagicLink"]>[0][] = [];
    const client: EmailClient = {
      sendMagicLink: (args) => {
        calls.push(args);
        return Effect.void;
      },
    };

    await runPromiseEffect(
      sendMagicLinkEmail(client, {
        resendApiKey: "test-resend-key",
        resendFromEmail: "Template <login@example.com>",
        email: "user@test.local",
        appName: "Template",
        htmlBody: "<p>body</p>",
      }),
    );

    expect(calls).toEqual([
      {
        apiKey: "test-resend-key",
        from: "Template <login@example.com>",
        email: "user@test.local",
        subject: "Sign in to Template",
        htmlBody: "<p>body</p>",
      },
    ]);
  });

  it("surfaces provider failures", async () => {
    const client: EmailClient = {
      sendMagicLink: () =>
        Effect.fail(new ExternalServiceError({ service: "resend", message: "provider down" })),
    };

    await expect(
      runPromiseEffect(
        sendMagicLinkEmail(client, {
          resendApiKey: "test-resend-key",
          resendFromEmail: "Template <login@example.com>",
          email: "user@test.local",
          appName: "Template",
          htmlBody: "<p>body</p>",
        }),
      ),
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });
});

describe("magicLinkEmail", () => {
  it("escapes interpolated app and email values", () => {
    const html = magicLinkEmail({
      appName: "Template <App>",
      email: "user+<tag>@test.local",
      url: "https://example.com/login?token=<abc>&next=/",
      expiresInSeconds: 300,
    });

    expect(html).toContain("Template &lt;App&gt;");
    expect(html).toContain("user+&lt;tag&gt;@test.local");
    expect(html).toContain('href="https://example.com/login?token=&lt;abc&gt;&amp;next=/"');
    expect(html).toContain("This link expires in 5 minutes.");
    expect(html).not.toContain("user+<tag>@test.local");
  });
});
