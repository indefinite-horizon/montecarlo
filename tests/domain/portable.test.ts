/** Unit tests for versioned portable workspace envelope validation. */

import { describe, expect, it } from "vitest";
import {
  domainId,
  type PortableValidationIssue,
  PortableWorkspaceValidationError,
  parsePortableWorkspaceEnvelope,
  validatePortableWorkspaceEnvelope,
  type Workspace,
} from "../../components/domain/src";
import { fixtureIds, makePortableWorkspaceEnvelope } from "./fixtures";

function issueCodes(issues: readonly PortableValidationIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function requireEntry<T>(entries: readonly T[], index: number, label: string): T {
  const entry = entries[index];
  if (!entry) throw new Error(`Expected ${label} fixture at index ${index}`);
  return entry;
}

describe("portable workspace envelope", () => {
  it("accepts a fully connected v1 envelope and returns the same validated value", () => {
    const envelope = makePortableWorkspaceEnvelope();
    const result = validatePortableWorkspaceEnvelope(envelope);

    expect(result).toEqual({ ok: true, value: envelope });
    expect(parsePortableWorkspaceEnvelope(envelope)).toBe(envelope);
  });

  it("rejects unsupported envelope and manifest versions before reference validation", () => {
    const envelope = makePortableWorkspaceEnvelope();
    const futureEnvelope = { ...envelope, envelopeVersion: 2 };
    const futureManifest = {
      ...envelope,
      manifest: { ...envelope.manifest, schemaVersion: 2 },
    };

    const envelopeResult = validatePortableWorkspaceEnvelope(futureEnvelope);
    const manifestResult = validatePortableWorkspaceEnvelope(futureManifest);

    expect(envelopeResult.ok).toBe(false);
    expect(manifestResult.ok).toBe(false);
    if (!envelopeResult.ok)
      expect(issueCodes(envelopeResult.issues)).toContain("unsupported_version");
    if (!manifestResult.ok)
      expect(issueCodes(manifestResult.issues)).toContain("unsupported_version");
  });

  it("requires mandatory timestamps instead of silently treating them as optional", () => {
    const envelope = makePortableWorkspaceEnvelope();
    (envelope.manifest.workspace as Partial<Workspace>).createdAt = undefined;

    const result = validatePortableWorkspaceEnvelope(envelope);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "$.manifest.workspace.createdAt", code: "invalid_type" }),
      );
    }
  });

  it("finds missing project, blob, and run references", () => {
    const envelope = makePortableWorkspaceEnvelope();
    const chat = requireEntry(envelope.manifest.chats, 0, "chat");
    const message = requireEntry(envelope.manifest.messages, 0, "message");
    chat.projectId = domainId<"project">("project-missing");
    message.parts.push({
      type: "blob",
      blobId: domainId<"blob">("blob-missing"),
      mediaType: "image/png",
    });
    message.runId = domainId<"run">("run-missing");

    const result = validatePortableWorkspaceEnvelope(envelope);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining([
          "$.manifest.chats[0].projectId",
          "$.manifest.messages[0].parts[1].blobId",
          "$.manifest.messages[0].runId",
        ]),
      );
    }
  });

  it("detects duplicate per-branch sequences and stale highlighted selections", () => {
    const envelope = makePortableWorkspaceEnvelope();
    requireEntry(envelope.manifest.messages, 3, "child assistant message").sequence = 0;
    const childBranch = envelope.manifest.branches[1];
    if (childBranch?.origin.type !== "selection") {
      throw new Error("Expected the fixture child branch to use a selection origin");
    }
    childBranch.origin.selection.selectedText = "outdated text";

    const result = validatePortableWorkspaceEnvelope(envelope);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result.issues)).toEqual(
        expect.arrayContaining(["duplicate_id", "invalid_selection"]),
      );
    }
  });

  it("uses content-addressed blob metadata without embedding a storage backend path", () => {
    const envelope = makePortableWorkspaceEnvelope();
    const blobId = domainId<"blob">("blob-image");
    envelope.manifest.blobs = [
      {
        id: blobId,
        mediaType: "image/png",
        byteLength: 42,
        fileName: "tree.png",
        digest: { algorithm: "sha256", value: "a".repeat(64) },
      },
    ];
    requireEntry(envelope.manifest.messages, 0, "root user message").parts.push({
      type: "blob",
      blobId,
      mediaType: "image/png",
      name: "tree.png",
    });

    expect(validatePortableWorkspaceEnvelope(envelope)).toEqual({ ok: true, value: envelope });
    expect(Object.keys(envelope.manifest.blobs[0] ?? {})).not.toContain("storagePath");
  });

  it("throws one typed error carrying all validation issues", () => {
    const envelope = makePortableWorkspaceEnvelope();
    requireEntry(envelope.manifest.chats, 0, "chat").rootBranchId = fixtureIds.childBranch;

    expect(() => parsePortableWorkspaceEnvelope(envelope)).toThrowError(
      PortableWorkspaceValidationError,
    );
  });
});
