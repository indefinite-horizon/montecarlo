/** Pure positioning helpers for the draggable development tools menu. */

type Position = { x: number; y: number };
type Size = { width: number; height: number };
type PositionStorage = Pick<Storage, "getItem" | "setItem">;

const VIEWPORT_GUTTER = 8;
const DEV_TOOLS_POSITION_STORAGE_KEY = "monte-carlo:dev-tools-position";

export function readDevToolsPosition(storage: Pick<Storage, "getItem">): Position | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(DEV_TOOLS_POSITION_STORAGE_KEY) ?? "null");
    if (
      typeof value !== "object" ||
      value === null ||
      !("x" in value) ||
      !("y" in value) ||
      typeof value.x !== "number" ||
      typeof value.y !== "number" ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y)
    ) {
      return null;
    }
    return { x: value.x, y: value.y };
  } catch {
    return null;
  }
}

export function writeDevToolsPosition(storage: PositionStorage, position: Position): void {
  try {
    storage.setItem(DEV_TOOLS_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Development tooling should remain usable when browser storage is unavailable.
  }
}

export function clampDevToolsPosition(
  position: Position,
  menuSize: Size,
  viewportSize: Size,
): Position {
  const halfWidth = menuSize.width / 2;
  const minX = Math.min(halfWidth + VIEWPORT_GUTTER, viewportSize.width / 2);
  const maxX = Math.max(viewportSize.width - halfWidth - VIEWPORT_GUTTER, minX);
  const maxY = Math.max(viewportSize.height - menuSize.height - VIEWPORT_GUTTER, VIEWPORT_GUTTER);

  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, VIEWPORT_GUTTER), maxY),
  };
}
