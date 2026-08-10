/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_analyticsFlushNode from "../actions/analyticsFlushNode.js";
import type * as auth from "../auth.js";
import type * as blobManifests from "../blobManifests.js";
import type * as branches from "../branches.js";
import type * as chats from "../chats.js";
import type * as config from "../config.js";
import type * as crons from "../crons.js";
import type * as effect_AppError from "../effect/AppError.js";
import type * as effect_analytics from "../effect/analytics.js";
import type * as effect_programs_sendMagicLinkEmail from "../effect/programs/sendMagicLinkEmail.js";
import type * as effect_runtime from "../effect/runtime.js";
import type * as effect_services_EmailClient from "../effect/services/EmailClient.js";
import type * as emails_magicLink from "../emails/magicLink.js";
import type * as env from "../env.js";
import type * as functions_analyticsOutbox from "../functions/analyticsOutbox.js";
import type * as functions_authAudit from "../functions/authAudit.js";
import type * as functions_devAuth from "../functions/devAuth.js";
import type * as functions_devTools from "../functions/devTools.js";
import type * as http from "../http.js";
import type * as init from "../init.js";
import type * as lib_analytics_enqueue from "../lib/analytics/enqueue.js";
import type * as lib_analytics_events from "../lib/analytics/events.js";
import type * as lib_authSecurity from "../lib/authSecurity.js";
import type * as lib_devToolsGate from "../lib/devToolsGate.js";
import type * as lib_domainValidation from "../lib/domainValidation.js";
import type * as lib_domainValidators from "../lib/domainValidators.js";
import type * as lib_localIdentity from "../lib/localIdentity.js";
import type * as lib_localWorkspaceBootstrap from "../lib/localWorkspaceBootstrap.js";
import type * as lib_logger from "../lib/logger.js";
import type * as lib_workspaceAuth from "../lib/workspaceAuth.js";
import type * as messageHistory from "../messageHistory.js";
import type * as messages from "../messages.js";
import type * as projects from "../projects.js";
import type * as runs from "../runs.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/analyticsFlushNode": typeof actions_analyticsFlushNode;
  auth: typeof auth;
  blobManifests: typeof blobManifests;
  branches: typeof branches;
  chats: typeof chats;
  config: typeof config;
  crons: typeof crons;
  "effect/AppError": typeof effect_AppError;
  "effect/analytics": typeof effect_analytics;
  "effect/programs/sendMagicLinkEmail": typeof effect_programs_sendMagicLinkEmail;
  "effect/runtime": typeof effect_runtime;
  "effect/services/EmailClient": typeof effect_services_EmailClient;
  "emails/magicLink": typeof emails_magicLink;
  env: typeof env;
  "functions/analyticsOutbox": typeof functions_analyticsOutbox;
  "functions/authAudit": typeof functions_authAudit;
  "functions/devAuth": typeof functions_devAuth;
  "functions/devTools": typeof functions_devTools;
  http: typeof http;
  init: typeof init;
  "lib/analytics/enqueue": typeof lib_analytics_enqueue;
  "lib/analytics/events": typeof lib_analytics_events;
  "lib/authSecurity": typeof lib_authSecurity;
  "lib/devToolsGate": typeof lib_devToolsGate;
  "lib/domainValidation": typeof lib_domainValidation;
  "lib/domainValidators": typeof lib_domainValidators;
  "lib/localIdentity": typeof lib_localIdentity;
  "lib/localWorkspaceBootstrap": typeof lib_localWorkspaceBootstrap;
  "lib/logger": typeof lib_logger;
  "lib/workspaceAuth": typeof lib_workspaceAuth;
  messageHistory: typeof messageHistory;
  messages: typeof messages;
  projects: typeof projects;
  runs: typeof runs;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
