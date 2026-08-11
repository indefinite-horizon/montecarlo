/** Verifies atomic filesystem storage, confinement, and integrity detection. */

import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemObjectStore } from "./filesystem.js";
import { InvalidObjectKeyError, ObjectIntegrityError } from "./types.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), label));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("FilesystemObjectStore", () => {
  it("atomically round-trips bytes and returns a portable integrity manifest", async () => {
    const root = await temporaryDirectory("montecarlo-store-");
    const store = new FilesystemObjectStore({ rootDirectory: root });
    const key = "v1/workspaces/workspace_1/chats/chat_1/messages/message_1.json";
    const data = Buffer.from('{"version":1,"content":"hello"}', "utf8");
    const expectedDigest = createHash("sha256").update(data).digest("hex");

    const manifest = await store.put({
      key,
      data,
      mediaType: "application/json",
      envelopeVersion: 1,
      expectedSha256: expectedDigest,
    });
    const stored = await store.get(key);

    expect(manifest).toMatchObject({
      version: 1,
      backend: "filesystem",
      key,
      sha256: expectedDigest,
      byteLength: data.byteLength,
      mediaType: "application/json",
      envelopeVersion: 1,
    });
    expect(manifest).not.toHaveProperty("path");
    expect(Buffer.from(stored.data)).toEqual(data);

    const bodyPath = join(root, "workspace_1", "objects", ...key.split("/"));
    expect((await lstat(bodyPath)).mode & 0o077).toBe(0);
    const workspaceFiles = await readdir(join(root, "workspace_1"), { recursive: true });
    expect(
      workspaceFiles.some((name) => name.includes(".montecarlo-") && name.endsWith(".tmp")),
    ).toBe(false);
  });

  it("rejects traversal and symlinked workspace paths", async () => {
    const root = await temporaryDirectory("montecarlo-store-");
    const outside = await temporaryDirectory("montecarlo-outside-");
    await symlink(outside, join(root, "workspace_link"));
    const store = new FilesystemObjectStore({ rootDirectory: root });

    await expect(
      store.put({
        key: "v1/workspaces/workspace_link/messages/message_1.json",
        data: Buffer.from("safe"),
        mediaType: "text/plain",
        envelopeVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ObjectIntegrityError);
    expect(await readdir(outside)).toEqual([]);
    await expect(
      store.get("v1/workspaces/workspace_1/../workspace_2/message.json"),
    ).rejects.toBeInstanceOf(InvalidObjectKeyError);
  });

  it("detects body tampering instead of returning corrupt content", async () => {
    const root = await temporaryDirectory("montecarlo-store-");
    const store = new FilesystemObjectStore({ rootDirectory: root });
    const key = "v1/workspaces/workspace_1/messages/message_1.json";
    await store.put({
      key,
      data: Buffer.from("original"),
      mediaType: "application/json",
      envelopeVersion: 1,
    });

    const bodyPath = join(root, "workspace_1", "objects", ...key.split("/"));
    await writeFile(bodyPath, "tampered");
    await expect(store.get(key)).rejects.toBeInstanceOf(ObjectIntegrityError);
  });

  it("serializes concurrent writes so data and metadata stay consistent", async () => {
    const root = await temporaryDirectory("montecarlo-store-");
    const store = new FilesystemObjectStore({ rootDirectory: root });
    const key = "v1/workspaces/workspace_1/messages/message_1.json";
    const first = Buffer.from("first");
    const second = Buffer.from("second");

    await Promise.all([
      store.put({ key, data: first, mediaType: "text/plain", envelopeVersion: 1 }),
      store.put({ key, data: second, mediaType: "text/plain", envelopeVersion: 1 }),
    ]);
    const stored = await store.get(key);
    expect(Buffer.from(stored.data)).toEqual(second);
    expect(stored.manifest.sha256).toBe(createHash("sha256").update(second).digest("hex"));
  });
});
