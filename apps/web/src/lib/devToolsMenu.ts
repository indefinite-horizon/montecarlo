/** Pure positioning helpers for the draggable development tools menu. */

type Position = { x: number; y: number };
type Size = { width: number; height: number };

const VIEWPORT_GUTTER = 8;

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
