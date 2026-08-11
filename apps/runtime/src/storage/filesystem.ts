/** Persists integrity-checked objects beneath a confined local workspace root. */

import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  type FileHandle,
  constants as fileConstants,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { runtimeDefaults } from "../config.js";
import { assertValidPutObjectInput, type ParsedObjectKey, parsePortableObjectKey } from "./key.js";
import {
  ObjectIntegrityError,
  type ObjectManifestV1,
  ObjectNotFoundError,
  type ObjectStoreV1,
  objectStoreContractVersion,
  type PutObjectInput,
  type StoredObjectV1,
} from "./types.js";

const metadataSchema = z
  .object({
    version: z.literal(objectStoreContractVersion),
    key: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
    mediaType: z.string().min(1).max(255),
    envelopeVersion: z.number().int().positive(),
  })
  .strict();

type FileMetadata = z.infer<typeof metadataSchema>;

export interface FilesystemObjectStoreOptions {
  rootDirectory: string;
  maxObjectBytes?: number;
}

interface ObjectLocations {
  body: string;
  metadata: string;
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isWithin(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

export class FilesystemObjectStore implements ObjectStoreV1 {
  readonly version = objectStoreContractVersion;
  readonly backend = "filesystem" as const;

  private readonly rootDirectory: string;
  private readonly maxObjectBytes: number;
  private readonly writeTails = new Map<string, Promise<void>>();
  private rootRealPathPromise?: Promise<string>;

  constructor(options: FilesystemObjectStoreOptions) {
    this.rootDirectory = resolve(options.rootDirectory);
    this.maxObjectBytes = options.maxObjectBytes ?? runtimeDefaults.maxBlobBytes;
  }

  put(input: PutObjectInput, signal?: AbortSignal): Promise<ObjectManifestV1> {
    const parsed = parsePortableObjectKey(input.key);
    assertValidPutObjectInput(input);
    return this.withWriteLock(parsed.key, async () => {
      signal?.throwIfAborted();
      if (input.data.byteLength > this.maxObjectBytes) {
        throw new ObjectIntegrityError("The object exceeds the configured storage limit.");
      }
      const digest = sha256(input.data);
      if (input.expectedSha256 !== undefined && input.expectedSha256 !== digest) {
        throw new ObjectIntegrityError("The supplied SHA-256 does not match the object body.");
      }

      const metadata: FileMetadata = {
        version: objectStoreContractVersion,
        key: parsed.key,
        sha256: digest,
        byteLength: input.data.byteLength,
        mediaType: input.mediaType,
        envelopeVersion: input.envelopeVersion,
      };
      const locations = this.locations(parsed);
      await this.atomicWrite(locations.body, input.data, signal);
      await this.atomicWrite(
        locations.metadata,
        Buffer.from(`${JSON.stringify(metadata)}\n`, "utf8"),
        signal,
      );

      return this.toManifest(metadata);
    });
  }

  async get(key: string, signal?: AbortSignal): Promise<StoredObjectV1> {
    const parsed = parsePortableObjectKey(key);
    return this.withWriteLock(parsed.key, async () => {
      const locations = this.locations(parsed);
      const metadataBytes = await this.readSafeFile(locations.metadata, 16 * 1_024, signal);
      let metadataValue: unknown;
      try {
        metadataValue = JSON.parse(Buffer.from(metadataBytes).toString("utf8")) as unknown;
      } catch {
        throw new ObjectIntegrityError();
      }
      const metadata = metadataSchema.safeParse(metadataValue);
      if (!metadata.success || metadata.data.key !== parsed.key) throw new ObjectIntegrityError();

      const data = await this.readSafeFile(locations.body, this.maxObjectBytes, signal);
      if (data.byteLength !== metadata.data.byteLength || sha256(data) !== metadata.data.sha256) {
        throw new ObjectIntegrityError();
      }
      return { manifest: this.toManifest(metadata.data), data };
    });
  }

  private locations(parsed: ParsedObjectKey): ObjectLocations {
    const workspaceDirectory = join(this.rootDirectory, parsed.workspaceId);
    return {
      body: join(workspaceDirectory, "objects", ...parsed.segments),
      metadata: `${join(workspaceDirectory, "object-metadata", ...parsed.segments)}.json`,
    };
  }

  private toManifest(metadata: FileMetadata): ObjectManifestV1 {
    return {
      ...metadata,
      backend: this.backend,
      storageVersion: metadata.sha256,
    };
  }

  private rootRealPath(): Promise<string> {
    this.rootRealPathPromise ??= this.initializeRoot();
    return this.rootRealPathPromise;
  }

  private async initializeRoot(): Promise<string> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.rootDirectory);
    this.assertSafeDirectoryInfo(info, true);
    return realpath(this.rootDirectory);
  }

  private async ensureSafeDirectory(directory: string, create: boolean): Promise<void> {
    const rootRealPath = await this.rootRealPath();
    const lexicalRelative = relative(this.rootDirectory, directory);
    if (!isWithin(this.rootDirectory, directory)) {
      throw new ObjectIntegrityError("A storage path escaped the workspace storage root.");
    }
    if (lexicalRelative === "") return;

    let current = this.rootDirectory;
    for (const segment of lexicalRelative.split(sep)) {
      current = join(current, segment);
      let info: Stats;
      try {
        info = await lstat(current);
      } catch (error) {
        if (!isMissing(error)) throw error;
        if (!create) throw new ObjectNotFoundError();
        try {
          await mkdir(current, { mode: 0o700 });
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
        }
        info = await lstat(current);
      }
      this.assertSafeDirectoryInfo(info, false);
      const currentRealPath = await realpath(current);
      if (!isWithin(rootRealPath, currentRealPath)) {
        throw new ObjectIntegrityError("A storage path escaped the workspace storage root.");
      }
    }
  }

  private assertSafeDirectoryInfo(info: Stats, root: boolean): void {
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new ObjectIntegrityError(
        root
          ? "The workspace storage root must be a real directory."
          : "A storage path component is not a safe directory.",
      );
    }
    if (process.platform !== "win32" && (info.mode & 0o022) !== 0) {
      throw new ObjectIntegrityError(
        root
          ? "The workspace storage root may not be group- or world-writable."
          : "A storage path component may not be group- or world-writable.",
      );
    }
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new ObjectIntegrityError(
        root
          ? "The workspace storage root must be owned by this user."
          : "A storage path component must be owned by this user.",
      );
    }
  }

  private async atomicWrite(target: string, data: Uint8Array, signal?: AbortSignal): Promise<void> {
    const parent = dirname(target);
    await this.ensureSafeDirectory(parent, true);
    await this.assertSafeFileIfPresent(target);
    signal?.throwIfAborted();

    const temporary = join(parent, `.montecarlo-${randomUUID()}.tmp`);
    let renamed = false;
    let handle: FileHandle | undefined;
    try {
      handle = await open(
        temporary,
        fileConstants.O_WRONLY |
          fileConstants.O_CREAT |
          fileConstants.O_EXCL |
          fileConstants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(data);
      await handle.sync();
      await handle.close();
      handle = undefined;
      signal?.throwIfAborted();
      await this.ensureSafeDirectory(parent, false);
      await rename(temporary, target);
      renamed = true;
    } finally {
      await handle?.close().catch(() => undefined);
      if (!renamed) {
        await unlink(temporary).catch(() => undefined);
      }
    }
  }

  private async assertSafeFileIfPresent(target: string): Promise<void> {
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new ObjectIntegrityError("The target object is not a safe regular file.");
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  private async readSafeFile(
    target: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    signal?.throwIfAborted();
    await this.ensureSafeDirectory(dirname(target), false);
    let info: Stats;
    try {
      info = await lstat(target);
    } catch (error) {
      if (isMissing(error)) throw new ObjectNotFoundError();
      throw error;
    }
    if (info.isSymbolicLink() || !info.isFile()) throw new ObjectIntegrityError();
    if (info.size > limit) throw new ObjectIntegrityError("The stored object exceeds its limit.");

    let handle: FileHandle | undefined;
    try {
      handle = await open(target, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile() || openedInfo.size > limit) throw new ObjectIntegrityError();
      const data = await handle.readFile();
      signal?.throwIfAborted();
      return data;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async withWriteLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.writeTails.get(key) ?? Promise.resolve();
    let release: (value: void | PromiseLike<void>) => void = () => undefined;
    const current = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    this.writeTails.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release(undefined);
      if (this.writeTails.get(key) === current) this.writeTails.delete(key);
    }
  }
}
