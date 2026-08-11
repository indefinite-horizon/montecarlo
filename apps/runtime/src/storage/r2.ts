/** Persists private integrity-checked objects through Cloudflare R2's S3 API. */

import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { runtimeDefaults } from "../config.js";
import { assertValidPutObjectInput, parsePortableObjectKey } from "./key.js";
import {
  ObjectIntegrityError,
  type ObjectManifestV1,
  ObjectNotFoundError,
  ObjectStoreConfigurationError,
  type ObjectStoreV1,
  objectStoreContractVersion,
  type PutObjectInput,
  type StoredObjectV1,
} from "./types.js";

const bucketPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const prefixPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;

export interface R2ObjectStoreOptions {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  prefix?: string;
  maxObjectBytes?: number;
  client?: S3Client;
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function validateEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ObjectStoreConfigurationError("R2_ENDPOINT must be a valid HTTPS URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ObjectStoreConfigurationError(
      "R2_ENDPOINT must be an HTTPS origin without credentials, a path, query, or fragment.",
    );
  }
  return url.origin;
}

function validatePrefix(raw: string | undefined): string | undefined {
  const prefix = raw?.trim().replace(/^\/+|\/+$/g, "");
  if (prefix === undefined || prefix === "") return undefined;
  if (
    !prefixPattern.test(prefix) ||
    prefix.includes("//") ||
    prefix.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new ObjectStoreConfigurationError("R2_PREFIX contains an unsafe object-key segment.");
  }
  return prefix;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function readNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export class R2ObjectStore implements ObjectStoreV1 {
  readonly version = objectStoreContractVersion;
  readonly backend = "r2" as const;

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix?: string;
  private readonly maxObjectBytes: number;

  constructor(options: R2ObjectStoreOptions) {
    const endpoint = validateEndpoint(options.endpoint);
    if (!bucketPattern.test(options.bucket)) {
      throw new ObjectStoreConfigurationError("R2_BUCKET must be a valid R2 bucket name.");
    }
    if (options.accessKeyId.trim() === "" || options.secretAccessKey.trim() === "") {
      throw new ObjectStoreConfigurationError("R2 credentials are required.");
    }
    this.bucket = options.bucket;
    this.prefix = validatePrefix(options.prefix);
    this.maxObjectBytes = options.maxObjectBytes ?? runtimeDefaults.maxBlobBytes;
    this.client =
      options.client ??
      new S3Client({
        region: "auto",
        endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
  }

  async put(input: PutObjectInput, signal?: AbortSignal): Promise<ObjectManifestV1> {
    const parsed = parsePortableObjectKey(input.key);
    assertValidPutObjectInput(input);
    signal?.throwIfAborted();
    if (input.data.byteLength > this.maxObjectBytes) {
      throw new ObjectIntegrityError("The object exceeds the configured storage limit.");
    }
    const digest = sha256(input.data);
    if (input.expectedSha256 !== undefined && input.expectedSha256 !== digest) {
      throw new ObjectIntegrityError("The supplied SHA-256 does not match the object body.");
    }

    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.remoteKey(parsed.key),
        Body: input.data,
        ContentLength: input.data.byteLength,
        ContentType: input.mediaType,
        Metadata: {
          "montecarlo-version": String(objectStoreContractVersion),
          sha256: digest,
          "byte-length": String(input.data.byteLength),
          "envelope-version": String(input.envelopeVersion),
        },
      }),
      { abortSignal: signal },
    );

    return {
      version: objectStoreContractVersion,
      backend: this.backend,
      key: parsed.key,
      sha256: digest,
      byteLength: input.data.byteLength,
      mediaType: input.mediaType,
      envelopeVersion: input.envelopeVersion,
      storageVersion: result.VersionId ?? result.ETag?.replaceAll('"', "") ?? digest,
    };
  }

  async get(key: string, signal?: AbortSignal): Promise<StoredObjectV1> {
    const parsed = parsePortableObjectKey(key);
    let result: GetObjectCommandOutput;
    try {
      result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.remoteKey(parsed.key) }),
        { abortSignal: signal },
      );
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError();
      throw error;
    }

    if (result.Body === undefined) throw new ObjectIntegrityError();
    if (result.ContentLength !== undefined && result.ContentLength > this.maxObjectBytes) {
      throw new ObjectIntegrityError("The stored object exceeds its limit.");
    }
    const data = await result.Body.transformToByteArray();
    if (data.byteLength > this.maxObjectBytes) throw new ObjectIntegrityError();

    const metadata = result.Metadata ?? {};
    const version = readPositiveInteger(metadata["montecarlo-version"]);
    const byteLength = readNonNegativeInteger(metadata["byte-length"]);
    const envelopeVersion = readPositiveInteger(metadata["envelope-version"]);
    const digest = sha256(data);
    if (
      version !== objectStoreContractVersion ||
      byteLength !== data.byteLength ||
      envelopeVersion === undefined ||
      metadata.sha256 !== digest
    ) {
      throw new ObjectIntegrityError();
    }
    const mediaType = result.ContentType ?? "application/octet-stream";
    if (
      mediaType.length > 255 ||
      [...mediaType].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    ) {
      throw new ObjectIntegrityError();
    }

    return {
      data,
      manifest: {
        version: objectStoreContractVersion,
        backend: this.backend,
        key: parsed.key,
        sha256: digest,
        byteLength,
        mediaType,
        envelopeVersion,
        storageVersion: result.VersionId ?? result.ETag?.replaceAll('"', "") ?? digest,
      },
    };
  }

  private remoteKey(key: string): string {
    return this.prefix === undefined ? key : `${this.prefix}/${key}`;
  }
}
