/** Backend-neutral blob manifests for filesystem and R2 object bodies. */

import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { convexConfig } from "./config";
import { env } from "./env";
import {
  createPublicId,
  requireNonNegativeInteger,
  requireSha256,
  requireText,
} from "./lib/domainValidation";
import { blobBackendValidator, blobStatusValidator } from "./lib/domainValidators";
import { requireWorkspacePermission } from "./lib/workspaceAuth";

const blobManifestValidator = v.object({
  id: v.id("blob_manifests"),
  publicId: v.string(),
  workspaceId: v.id("workspaces"),
  backend: blobBackendValidator,
  objectKey: v.string(),
  envelopeVersion: v.number(),
  contentType: v.string(),
  byteLength: v.number(),
  sha256: v.string(),
  status: blobStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

function toManifestResult(manifest: Doc<"blob_manifests">) {
  return {
    id: manifest._id,
    publicId: manifest.publicId,
    workspaceId: manifest.workspaceId,
    backend: manifest.backend,
    objectKey: manifest.objectKey,
    envelopeVersion: manifest.envelopeVersion,
    contentType: manifest.contentType,
    byteLength: manifest.byteLength,
    sha256: manifest.sha256,
    status: manifest.status,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  };
}

export const reserve = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    publicId: v.optional(v.string()),
    backend: blobBackendValidator,
    envelopeVersion: v.number(),
    contentType: v.string(),
    byteLength: v.number(),
    sha256: v.string(),
  },
  returns: blobManifestValidator,
  handler: async (ctx, args) => {
    const { user } = await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found.");
    }
    const expectedBackend = workspace.storageMode === "local" ? "filesystem" : "r2";
    if (args.backend !== expectedBackend) {
      throw new Error(`This workspace requires the ${expectedBackend} blob backend.`);
    }

    const publicId = createPublicId("blob", args.publicId);
    const contentType = requireText(
      args.contentType,
      "Content type",
      convexConfig.domain.limits.contentTypeLength,
    );
    const byteLength = requireNonNegativeInteger(args.byteLength, "Byte length");
    const envelopeVersion = requireNonNegativeInteger(args.envelopeVersion, "Envelope version");
    if (envelopeVersion < 1) {
      throw new Error("Envelope version must be a positive integer.");
    }
    const sha256 = requireSha256(args.sha256);
    const existingPublicId = await ctx.db
      .query("blob_manifests")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", publicId),
      )
      .unique();
    if (existingPublicId) {
      if (
        existingPublicId.sha256 !== sha256 ||
        existingPublicId.byteLength !== byteLength ||
        existingPublicId.envelopeVersion !== envelopeVersion ||
        existingPublicId.contentType !== contentType ||
        existingPublicId.backend !== args.backend
      ) {
        throw new Error("Blob public ID already refers to different content.");
      }
      return toManifestResult(existingPublicId);
    }

    const existingContent = await ctx.db
      .query("blob_manifests")
      .withIndex("by_workspace_sha256", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("sha256", sha256),
      )
      .unique();
    if (existingContent) {
      if (
        existingContent.byteLength !== byteLength ||
        existingContent.envelopeVersion !== envelopeVersion ||
        existingContent.contentType !== contentType ||
        existingContent.backend !== args.backend
      ) {
        throw new Error("Blob digest already exists with conflicting metadata.");
      }
      return toManifestResult(existingContent);
    }

    const now = Date.now();
    const objectKey = `v1/workspaces/${workspace.publicId}/objects/${sha256.slice(0, 2)}/${sha256}`;
    const manifestId = await ctx.db.insert("blob_manifests", {
      publicId,
      workspaceId: args.workspaceId,
      backend: args.backend,
      objectKey,
      envelopeVersion,
      contentType,
      byteLength,
      sha256,
      status: "reserved",
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id: manifestId,
      publicId,
      workspaceId: args.workspaceId,
      backend: args.backend,
      objectKey,
      envelopeVersion,
      contentType,
      byteLength,
      sha256,
      status: "reserved" as const,
      createdAt: now,
      updatedAt: now,
    };
  },
});

export const markAvailable = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    manifestId: v.id("blob_manifests"),
    attestation: v.string(),
  },
  returns: blobManifestValidator,
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:write");
    const manifest = await ctx.db.get(args.manifestId);
    if (!manifest || manifest.workspaceId !== args.workspaceId || manifest.status === "deleted") {
      throw new Error("Blob manifest not found in this workspace.");
    }
    const encodedPublicKey = env.MONTECARLO_BLOB_ATTESTATION_PUBLIC_KEY;
    if (!encodedPublicKey || !/^[A-Za-z0-9_-]{86}$/.test(args.attestation)) {
      throw new Error("Blob attestation is unavailable.");
    }
    const payload = [
      String(manifest._id),
      manifest.backend,
      manifest.objectKey,
      manifest.sha256,
      manifest.byteLength,
      manifest.envelopeVersion,
      manifest.contentType,
    ].join("\n");
    let verified = false;
    try {
      const publicKey = Uint8Array.from(atob(encodedPublicKey), (character) =>
        character.charCodeAt(0),
      );
      const normalizedSignature = args.attestation.replaceAll("-", "+").replaceAll("_", "/");
      const signature = Uint8Array.from(atob(`${normalizedSignature}==`), (character) =>
        character.charCodeAt(0),
      );
      const key = await crypto.subtle.importKey(
        "spki",
        publicKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      verified = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signature,
        new TextEncoder().encode(payload),
      );
    } catch {
      throw new Error("Blob attestation is unavailable.");
    }
    if (!verified) throw new Error("Blob attestation is invalid.");
    const updatedAt = manifest.status === "available" ? manifest.updatedAt : Date.now();
    if (manifest.status !== "available") {
      await ctx.db.patch(manifest._id, { status: "available", updatedAt });
    }
    return toManifestResult({ ...manifest, status: "available", updatedAt });
  },
});

export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    publicId: v.string(),
  },
  returns: v.union(blobManifestValidator, v.null()),
  handler: async (ctx, args) => {
    await requireWorkspacePermission(ctx, args.workspaceId, "content:read");
    const publicId = createPublicId("blob", args.publicId);
    const manifest = await ctx.db
      .query("blob_manifests")
      .withIndex("by_workspace_public_id", (index) =>
        index.eq("workspaceId", args.workspaceId).eq("publicId", publicId),
      )
      .unique();
    if (!manifest || manifest.status === "deleted") return null;
    return toManifestResult(manifest);
  },
});
