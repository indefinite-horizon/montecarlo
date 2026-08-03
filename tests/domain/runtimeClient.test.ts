/** Unit tests for browser runtime stream parsing. */

import { describe, expect, it } from "vitest";
import { parseEventBlock } from "../../apps/web/src/lib/runtimeClient";

describe("runtime event parsing", () => {
  it("ignores malformed event frames without aborting the stream", () => {
    expect(parseEventBlock('data: {"type":"text-delta","delta":"ok"}')).toEqual({
      type: "text-delta",
      delta: "ok",
    });
    expect(parseEventBlock("data: {not-json")).toBeUndefined();
  });
});
