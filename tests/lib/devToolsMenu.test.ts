/** Tests viewport clamping for the draggable development tools menu. */

import { describe, expect, it } from "vitest";
import {
  clampDevToolsPosition,
  readDevToolsPosition,
  writeDevToolsPosition,
} from "../../apps/web/src/lib/devToolsMenu";

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

describe("development tools position persistence", () => {
  it("round trips a dragged position", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writeDevToolsPosition(storage, { x: 420, y: 96 });

    expect(readDevToolsPosition(storage)).toEqual({ x: 420, y: 96 });
  });

  it.each([
    "not-json",
    "null",
    '{"x": 10}',
    '{"x": "10", "y": 20}',
    '{"x": 10, "y": null}',
  ])("ignores an invalid stored position: %s", (storedValue) => {
    expect(readDevToolsPosition({ getItem: () => storedValue })).toBeNull();
  });

  it("tolerates unavailable browser storage", () => {
    expect(
      readDevToolsPosition({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBeNull();
    expect(() =>
      writeDevToolsPosition(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("blocked");
          },
        },
        { x: 420, y: 96 },
      ),
    ).not.toThrow();
  });
});
