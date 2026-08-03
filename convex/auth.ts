/** Configures Better Auth integration and user provisioning triggers for Convex. */

import { type AuthFunctions, createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { isMutationCtx, isRunMutationCtx } from "@convex-dev/better-auth/utils";
import { getAppName } from "@monte-carlo/app-constants";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins";
import type { GenericActionCtx } from "convex/server";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { convexConfig } from "./config";
import { magicLinkEmail } from "./emails/magicLink";
import { devAllowedOrigins, env, isDev, isLocalDev, localAnonymousWorkspacesEnabled } from "./env";
import { enqueueAnalyticsEvent } from "./lib/analytics/enqueue";
import { buildUserSignedUpEvent } from "./lib/analytics/events";
import { assertSafeProductionBetterAuthSecret } from "./lib/authSecurity";
import { LOCAL_ANONYMOUS_AUTH_SUBJECT } from "./lib/localIdentity";

const authFunctions: AuthFunctions = {
  onCreate: internal.auth.onCreate,
  onUpdate: internal.auth.onUpdate,
  onDelete: internal.auth.onDelete,
};

type AuthAuditLogInput = {
  event: "auth.session_created" | "auth.account_linked";
  actorAuthSubject: string;
  provider?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: number;
};

async function writeAuthAuditLog(ctx: GenericCtx<DataModel>, input: AuthAuditLogInput) {
  if (isMutationCtx(ctx)) {
    await ctx.db.insert("auth_audit_logs", input);
    return;
  }
  if (isRunMutationCtx(ctx)) {
    await ctx.runMutation(internal.functions.authAudit.write, input);
    return;
  }
  throw new Error("Auth audit writes require a mutation-capable context.");
}

export const authComponent = createClient<DataModel>(components.betterAuth, {
  triggers: {
    user: {
      onCreate: async (ctx, doc) => {
        const existing = await ctx.db
          .query("users")
          .withIndex("by_auth_subject", (q) => q.eq("authSubject", doc._id))
          .first();
        if (existing) return;

        const now = Date.now();
        const userId = await ctx.db.insert("users", {
          authSubject: doc._id,
          email: doc.email,
          name: doc.name,
          image: doc.image ?? undefined,
          createdAt: now,
          updatedAt: now,
        });
        await enqueueAnalyticsEvent(
          ctx as Parameters<typeof enqueueAnalyticsEvent>[0],
          buildUserSignedUpEvent({
            authSubject: doc._id,
            userId,
            method: "email",
            occurredAt: now,
          }),
        );
      },
      onUpdate: async (ctx, newDoc, oldDoc) => {
        if (
          newDoc.email === oldDoc.email &&
          newDoc.name === oldDoc.name &&
          newDoc.image === oldDoc.image
        ) {
          return;
        }
        const existing = await ctx.db
          .query("users")
          .withIndex("by_auth_subject", (q) => q.eq("authSubject", newDoc._id))
          .first();
        if (!existing) return;
        await ctx.db.patch(existing._id, {
          email: newDoc.email,
          name: newDoc.name,
          image: newDoc.image ?? undefined,
          updatedAt: Date.now(),
        });
      },
    },
  },
  authFunctions,
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const authBaseUrl = env.CONVEX_SITE_URL || env.SITE_URL;
  const googleEnabled = env.GOOGLE_CLIENT_ID !== "" && env.GOOGLE_CLIENT_SECRET !== "";
  const appName = getAppName(isDev);
  assertSafeProductionBetterAuthSecret(env.BETTER_AUTH_SECRET, isDev);

  return betterAuth({
    appName,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: authBaseUrl,
    trustedOrigins: isDev ? devAllowedOrigins : [env.SITE_URL],
    database: authComponent.adapter(ctx),
    rateLimit: {
      enabled: !isDev,
      storage: "database",
      window: 3600,
      max: 10000,
      customRules: {
        "/sign-in/magic-link": { window: 60, max: 5 },
      },
    },
    socialProviders: {
      ...(googleEnabled
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: googleEnabled ? ["google", "magic-link"] : ["magic-link"],
      },
      encryptOAuthTokens: true,
    },
    plugins: [
      convex({ authConfig }),
      crossDomain({ siteUrl: env.SITE_URL }),
      magicLink({
        disableSignUp: false,
        expiresIn: convexConfig.auth.magicLink.expiresInSeconds,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          if (isLocalDev) {
            await (ctx as GenericActionCtx<DataModel>).runMutation(
              internal.functions.devAuth.storeDevMagicLink,
              { email, url },
            );
            return;
          }

          const { sendMagicLinkEmail } = await import("./effect/programs/sendMagicLinkEmail");
          const { makeResendEmailClient } = await import("./effect/services/EmailClient");
          const { runPromiseEffect } = await import("./effect/runtime");

          await runPromiseEffect(
            sendMagicLinkEmail(makeResendEmailClient(), {
              resendApiKey: env.RESEND_API_KEY,
              resendFromEmail: env.RESEND_FROM_EMAIL,
              email,
              appName,
              htmlBody: magicLinkEmail({
                appName,
                url,
                email,
                expiresInSeconds: convexConfig.auth.magicLink.expiresInSeconds,
              }),
            }),
          );
        },
      }),
    ],
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
      },
      useSecureCookies: !isDev,
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await writeAuthAuditLog(ctx, {
              event: "auth.session_created",
              actorAuthSubject: session.userId,
              ipAddress: session.ipAddress ?? undefined,
              userAgent: session.userAgent ?? undefined,
              createdAt: Date.now(),
            });
          },
        },
      },
      account: {
        create: {
          after: async (account) => {
            await writeAuthAuditLog(ctx, {
              event: "auth.account_linked",
              actorAuthSubject: account.userId,
              provider: account.providerId,
              createdAt: Date.now(),
            });
          },
        },
      },
    },
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      if (!localAnonymousWorkspacesEnabled) return null;
      const localUser = await ctx.db
        .query("users")
        .withIndex("by_auth_subject", (q) => q.eq("authSubject", LOCAL_ANONYMOUS_AUTH_SUBJECT))
        .unique();
      if (!localUser) return null;
      return {
        id: localUser._id,
        email: localUser.email ?? null,
        name: localUser.name ?? null,
        image: localUser.image ?? null,
      };
    }
    const appUser = await ctx.db
      .query("users")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", authUser._id))
      .first();
    if (!appUser) return null;
    return {
      id: appUser._id,
      email: appUser.email ?? authUser.email,
      name: appUser.name ?? authUser.name ?? null,
      image: appUser.image ?? authUser.image ?? null,
    };
  },
});
