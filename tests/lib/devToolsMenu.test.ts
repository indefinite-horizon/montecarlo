/** Tests viewport clamping for the draggable development tools menu. */

import { describe, expect, it } from "vitest";
import { clampDevToolsPosition } from "../../apps/web/src/lib/devToolsMenu";

describe("clampDevToolsPosition", () => {
  const menu = { width: 200, height: 120 };
  const viewport = { width: 1_000, height: 800 };

  it("keeps an in-bounds position unchanged", () => {
    expect(clampDevToolsPosition({ x: 500, y: 200 }, menu, viewport)).toEqual({
      x: 500,
      y: 200,
    });
  });

  it("keeps the complete menu within the viewport gutter", () => {
    expect(clampDevToolsPosition({ x: -50, y: -50 }, menu, viewport)).toEqual({
      x: 108,
      y: 8,
    });
    expect(clampDevToolsPosition({ x: 1_100, y: 900 }, menu, viewport)).toEqual({
      x: 892,
      y: 672,
    });
  });

  it("centers a menu that is wider than the viewport", () => {
    expect(
      clampDevToolsPosition(
        { x: 0, y: 0 },
        { width: 500, height: 500 },
        { width: 320, height: 300 },
      ),
    ).toEqual({ x: 160, y: 8 });
  });
});
