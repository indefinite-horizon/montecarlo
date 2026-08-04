/** Executable acceptance contract for the planned workspace transfer UI. */

import { test } from "@playwright/test";

const portabilityCases = [
  "exports local workspace and imports it into cloud with graph and hashes intact",
  "exports cloud workspace and imports it into local with graph and hashes intact",
  "repeated import is idempotent",
  "corrupt object or reference rejects the staged import atomically",
  "imported conversation continues without provider-native session identifiers",
] as const;

for (const title of portabilityCases) {
  test(title, async () => {
    test.fixme(true, "Workspace transfer is explicitly documented as not wired into the UI yet.");
  });
}
