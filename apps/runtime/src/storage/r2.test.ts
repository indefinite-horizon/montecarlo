/** Verifies private R2 requests and integrity metadata handling. */

import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { R2ObjectStore } from "./r2.js";

describe("R2ObjectStore", () => {
  it("uses prefixed private objects and verifies S3 metadata on read", async () => {
    const data = Buffer.from("r2 body");
    const digest = createHash("sha256").update(data).digest("hex");
    const commands: unknown[] = [];
    const fakeClient = {
      send: async (command: unknown) => {
        commands.push(command);
        if (command instanceof PutObjectCommand) return { ETag: '"etag-value"' };
        return {
          Body: { transformToByteArray: () => Promise.resolve(data) },
          ContentLength: data.byteLength,
          ContentType: "application/json",
          ETag: '"etag-value"',
          Metadata: {
            "monte-carlo-version": "1",
            sha256: digest,
            "byte-length": String(data.byteLength),
            "envelope-version": "2",
          },
        };
      },
    } as unknown as S3Client;
    const store = new R2ObjectStore({
      endpoint: "https://example.r2.cloudflarestorage.com",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      bucket: "montecarlo-blobs",
      prefix: "production/objects",
      client: fakeClient,
    });
    const key = "v1/workspaces/workspace_1/messages/message_1.json";

    const manifest = await store.put({
      key,
      data,
      mediaType: "application/json",
      envelopeVersion: 2,
    });
    const stored = await store.get(key);

    expect(manifest).toMatchObject({ backend: "r2", sha256: digest, storageVersion: "etag-value" });
    expect(stored.manifest).toMatchObject({ envelopeVersion: 2, sha256: digest });
    expect(Buffer.from(stored.data)).toEqual(data);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect((commands[0] as PutObjectCommand).input).toMatchObject({
      Bucket: "montecarlo-blobs",
      Key: `production/objects/${key}`,
      Metadata: { "monte-carlo-version": "1" },
    });
    expect(commands[1]).toBeInstanceOf(GetObjectCommand);
  });
});
