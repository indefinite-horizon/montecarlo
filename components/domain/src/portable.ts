/** Defines and validates the versioned, storage-neutral workspace interchange format. */

import { validatePortableWorkspaceManifestReferences } from "./portable-references";
import { validatePortableWorkspaceEnvelopeShape } from "./portable-shape";
import type { BlobId, Chat, ChatBranch, ChatMessage, ChatRun, Project, Workspace } from "./types";

export const PORTABLE_WORKSPACE_FORMAT = "monte-carlo.workspace" as const;
export const PORTABLE_WORKSPACE_ENVELOPE_VERSION = 1 as const;
export const PORTABLE_WORKSPACE_SCHEMA_VERSION = 1 as const;

/** Identifies one content-addressed payload without coupling exports to R2 or a filesystem. */
export interface PortableBlobDescriptor {
  id: BlobId;
  mediaType: string;
  byteLength: number;
  fileName?: string;
  digest: {
    algorithm: "sha256";
    value: string;
  };
}

export interface PortableWorkspaceManifestV1 {
  schemaVersion: typeof PORTABLE_WORKSPACE_SCHEMA_VERSION;
  workspace: Workspace;
  projects: readonly Project[];
  chats: readonly Chat[];
  branches: readonly ChatBranch[];
  messages: readonly ChatMessage[];
  runs: readonly ChatRun[];
  blobs: readonly PortableBlobDescriptor[];
}

export interface PortableWorkspaceEnvelopeV1 {
  format: typeof PORTABLE_WORKSPACE_FORMAT;
  envelopeVersion: typeof PORTABLE_WORKSPACE_ENVELOPE_VERSION;
  exportedAt: number;
  manifest: PortableWorkspaceManifestV1;
}

export type PortableWorkspaceManifest = PortableWorkspaceManifestV1;
export type PortableWorkspaceEnvelope = PortableWorkspaceEnvelopeV1;

export interface PortableValidationIssue {
  path: string;
  code:
    | "invalid_type"
    | "invalid_value"
    | "unsupported_version"
    | "duplicate_id"
    | "missing_reference"
    | "reference_mismatch"
    | "branch_tree"
    | "invalid_selection";
  message: string;
}

export type PortableValidationResult =
  | { ok: true; value: PortableWorkspaceEnvelope }
  | { ok: false; issues: readonly PortableValidationIssue[] };

export class PortableWorkspaceValidationError extends Error {
  readonly issues: readonly PortableValidationIssue[];

  constructor(issues: readonly PortableValidationIssue[]) {
    super(`Portable workspace validation failed with ${issues.length} issue(s)`);
    this.name = "PortableWorkspaceValidationError";
    this.issues = issues;
  }
}

/** Validates structure, versions, graph invariants, and all manifest references. */
export function validatePortableWorkspaceEnvelope(value: unknown): PortableValidationResult {
  const issues: PortableValidationIssue[] = [];
  const hasValidShape = validatePortableWorkspaceEnvelopeShape(
    value,
    {
      format: PORTABLE_WORKSPACE_FORMAT,
      envelopeVersion: PORTABLE_WORKSPACE_ENVELOPE_VERSION,
      schemaVersion: PORTABLE_WORKSPACE_SCHEMA_VERSION,
    },
    issues,
  );
  if (!hasValidShape) return { ok: false, issues };

  const typedEnvelope = value as PortableWorkspaceEnvelope;
  validatePortableWorkspaceManifestReferences(typedEnvelope.manifest, issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: typedEnvelope };
}

/** Returns a validated envelope or throws one error carrying every issue. */
export function parsePortableWorkspaceEnvelope(value: unknown): PortableWorkspaceEnvelope {
  const result = validatePortableWorkspaceEnvelope(value);
  if (result.ok) return result.value;
  throw new PortableWorkspaceValidationError(result.issues);
}
