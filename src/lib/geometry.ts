import type { Point, Rect, ToolbarPosition } from "@/lib/types";

export const TOOLBAR_GAP = 8;

export function computeToolbarPosition(
  sel: Rect,
  toolbar: { width: number; height: number },
  monitor: Rect,
): ToolbarPosition {
  // Preferred: below selection, left-aligned with selection
  const belowY = sel.y + sel.height + TOOLBAR_GAP;
  const aboveY = sel.y - toolbar.height - TOOLBAR_GAP;

  let x = sel.x;
  // Clamp horizontal
  if (x + toolbar.width + TOOLBAR_GAP > monitor.x + monitor.width) {
    x = monitor.x + monitor.width - toolbar.width - TOOLBAR_GAP;
  }
  if (x < monitor.x + TOOLBAR_GAP) x = monitor.x + TOOLBAR_GAP;

  if (belowY + toolbar.height + TOOLBAR_GAP <= monitor.y + monitor.height) {
    return { kind: "below", x, y: belowY };
  }
  if (aboveY >= monitor.y + TOOLBAR_GAP) {
    return { kind: "above", x, y: aboveY };
  }

  // Inside selection (bottom-right)
  const insideX = sel.x + sel.width - toolbar.width - TOOLBAR_GAP;
  const insideY = sel.y + sel.height - toolbar.height - TOOLBAR_GAP;
  return { kind: "inside", x: insideX, y: insideY };
}

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export function hitTestHandle(p: Point, sel: Rect, tol = 8): HandleId | null {
  const { x, y, width: w, height: h } = sel;
  const near = (px: number, py: number) =>
    Math.abs(p.x - px) <= tol && Math.abs(p.y - py) <= tol;

  if (near(x, y)) return "nw";
  if (near(x + w, y)) return "ne";
  if (near(x + w, y + h)) return "se";
  if (near(x, y + h)) return "sw";
  if (near(x + w / 2, y)) return "n";
  if (near(x + w, y + h / 2)) return "e";
  if (near(x + w / 2, y + h)) return "s";
  if (near(x, y + h / 2)) return "w";
  return null;
}

export function rectFromDrag(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function clampRect(r: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds.x, Math.min(r.x, bounds.x + bounds.width));
  const y = Math.max(bounds.y, Math.min(r.y, bounds.y + bounds.height));
  const right = Math.max(bounds.x, Math.min(r.x + r.width, bounds.x + bounds.width));
  const bottom = Math.max(bounds.y, Math.min(r.y + r.height, bounds.y + bounds.height));
  return { x, y, width: right - x, height: bottom - y };
}
