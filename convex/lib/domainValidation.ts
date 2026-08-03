/** Small runtime guards for bounded, portable domain inputs. */

import { convexConfig } from "../config";

const PUBLIC_ID_PATTERN = /^[a-z][a-z0-9]*_[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type PublicIdPrefix =
  | "blob"
  | "branch"
  | "chat"
  | "member"
  | "message"
  | "project"
  | "run"
  | "ws";

export function createPublicId(prefix: PublicIdPrefix, requested?: string): string {
  const publicId = requested?.trim() || `${prefix}_${crypto.randomUUID()}`;
  if (
    publicId.length > convexConfig.domain.limits.publicIdLength ||
    !PUBLIC_ID_PATTERN.test(publicId) ||
    !publicId.startsWith(`${prefix}_`)
  ) {
    throw new Error(`Invalid ${prefix} public ID.`);
  }
  return publicId;
}

export function requireText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

export function optionalText(
  value: string | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requireText(value, label, maxLength);
}

export function normalizeLimit(
  requested: number | undefined,
  defaultLimit: number = convexConfig.domain.limits.defaultPageSize,
  maxLimit: number = convexConfig.domain.limits.maxPageSize,
): number {
  const limit = requested ?? defaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new Error(`Limit must be an integer between 1 and ${maxLimit}.`);
  }
  return limit;
}

export function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

export function requireSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error("SHA-256 must be a 64-character lowercase hexadecimal digest.");
  }
  return normalized;
}
