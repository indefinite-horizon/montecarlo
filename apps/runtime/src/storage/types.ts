/** Defines the versioned object-store contract and integrity failures. */

export const objectStoreContractVersion = 1 as const;

export type ObjectStoreBackend = "filesystem" | "r2";

export interface PutObjectInput {
  key: string;
  data: Uint8Array;
  mediaType: string;
  envelopeVersion: number;
  expectedSha256?: string;
}

export interface ObjectManifestV1 {
  version: typeof objectStoreContractVersion;
  backend: ObjectStoreBackend;
  key: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  envelopeVersion: number;
  storageVersion?: string;
}

export interface StoredObjectV1 {
  manifest: ObjectManifestV1;
  data: Uint8Array;
}

export interface ObjectStoreV1 {
  readonly version: typeof objectStoreContractVersion;
  readonly backend: ObjectStoreBackend;
  put(input: PutObjectInput, signal?: AbortSignal): Promise<ObjectManifestV1>;
  get(key: string, signal?: AbortSignal): Promise<StoredObjectV1>;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("The requested object does not exist.");
    this.name = "ObjectNotFoundError";
  }
}

export class InvalidObjectKeyError extends Error {
  constructor(message = "The portable object key is invalid.") {
    super(message);
    this.name = "InvalidObjectKeyError";
  }
}

export class ObjectIntegrityError extends Error {
  constructor(message = "Stored object integrity verification failed.") {
    super(message);
    this.name = "ObjectIntegrityError";
  }
}

export class ObjectStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStoreConfigurationError";
  }
}
