/** Protects the shared browser/server selection-preview boundary. */

import { describe, expect, it } from "vitest";
import { selectionTextWithinPreview } from "../../apps/web/src/lib/messageSelection";
import { sharedConfig } from "../../lib/config";

describe("selectionTextWithinPreview", () => {
  it("clips a selection that crosses the persisted preview boundary", () => {
    const limit = sharedConfig.domain.limits.contentPreviewLength;
    const content = `${"a".repeat(limit - 5)}boundary text`;

    expect(selectionTextWithinPreview(content, limit - 5, "boundary text")).toBe("bound");
  });

  it("rejects selections that begin beyond the persisted preview boundary", () => {
    const limit = sharedConfig.domain.limits.contentPreviewLength;
    const content = `${"a".repeat(limit)}hidden selection`;

    expect(selectionTextWithinPreview(content, limit, "hidden selection")).toBeUndefined();
  });
});
