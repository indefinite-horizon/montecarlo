/** Validates portable workspace object keys and upload metadata. */

import { InvalidObjectKeyError, ObjectIntegrityError, type PutObjectInput } from "./types.js";

const keySegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const workspaceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const maxPortableKeyBytes = 1_024;

export interface ParsedObjectKey {
  key: string;
  workspaceId: string;
  segments: string[];
}

export function parsePortableObjectKey(key: string): ParsedObjectKey {
  if (key === "" || Buffer.byteLength(key, "utf8") > maxPortableKeyBytes) {
    throw new InvalidObjectKeyError();
  }
  if (key.includes("\\") || key.startsWith("/") || key.endsWith("/")) {
    throw new InvalidObjectKeyError();
  }

  const segments = key.split("/");
  const workspaceId = segments[2];
  if (
    segments.length < 4 ||
    segments[0] !== "v1" ||
    segments[1] !== "workspaces" ||
    workspaceId === undefined ||
    !workspaceIdPattern.test(workspaceId) ||
    segments.some((segment) => !keySegmentPattern.test(segment))
  ) {
    throw new InvalidObjectKeyError(
      "Object keys must use v1/workspaces/<workspace-id>/... with safe path segments.",
    );
  }
  return { key: segments.join("/"), workspaceId, segments };
}

export function decodeObjectKeyPath(pathname: string): string | undefined {
  const prefix = "/v1/blobs/";
  if (!pathname.startsWith(prefix)) return undefined;
  try {
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    throw new InvalidObjectKeyError("The object-key path encoding is invalid.");
  }
}

export function assertValidPutObjectInput(input: PutObjectInput): void {
  if (
    input.mediaType === "" ||
    input.mediaType.length > 255 ||
    [...input.mediaType].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new ObjectIntegrityError("The object media type is invalid.");
  }
  if (!Number.isSafeInteger(input.envelopeVersion) || input.envelopeVersion < 1) {
    throw new ObjectIntegrityError("The object envelope version is invalid.");
  }
  if (input.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.expectedSha256)) {
    throw new ObjectIntegrityError("The expected SHA-256 is invalid.");
  }
}
