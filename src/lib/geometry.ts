import type { Point, Rect, ToolbarPosition } from "@/lib/types";

export const TOOLBAR_GAP = 4;

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

  // Inside selection (bottom-left), preserving the normal left-aligned toolbar behavior.
  const insideX = Math.max(sel.x + TOOLBAR_GAP, monitor.x + TOOLBAR_GAP);
  const insideY = sel.y + sel.height - toolbar.height - TOOLBAR_GAP;
  return { kind: "inside", x: insideX, y: insideY };
}

export function computeVerticalToolbarPosition(
  sel: Rect,
  toolbar: { width: number; height: number },
  monitor: Rect,
): ToolbarPosition {
  // Preferred: to the right of the selection, top-aligned with selection.
  const rightX = sel.x + sel.width + TOOLBAR_GAP;
  const leftX = sel.x - toolbar.width - TOOLBAR_GAP;
  const minY = monitor.y + TOOLBAR_GAP;
  const maxY = monitor.y + monitor.height - toolbar.height - TOOLBAR_GAP;
  const y = clamp(sel.y, minY, maxY);

  if (rightX + toolbar.width + TOOLBAR_GAP <= monitor.x + monitor.width) {
    return { kind: "right", x: rightX, y };
  }
  if (leftX >= monitor.x + TOOLBAR_GAP) {
    return { kind: "left", x: leftX, y };
  }

  // Inside selection (top-right), mirroring the horizontal toolbar's inside fallback.
  const insideX = clamp(
    sel.x + sel.width - toolbar.width - TOOLBAR_GAP,
    monitor.x + TOOLBAR_GAP,
    monitor.x + monitor.width - toolbar.width - TOOLBAR_GAP,
  );
  const insideY = clamp(sel.y + TOOLBAR_GAP, minY, maxY);
  return { kind: "inside", x: insideX, y: insideY };
}

export function clampToolbarPosition(
  pos: { x: number; y: number },
  toolbar: { width: number; height: number },
  monitor: Rect,
): { x: number; y: number } {
  return {
    x: clamp(pos.x, monitor.x, monitor.x + monitor.width - toolbar.width),
    y: clamp(pos.y, monitor.y, monitor.y + monitor.height - toolbar.height),
  };
}

export function computeSidePanelPosition(
  toolbarPos: { x: number; y: number },
  monitor: Rect,
  panel: { width: number; height: number },
  gap: number,
): { left: number; top: number } {
  const monitorLeft = monitor.x;
  const monitorTop = monitor.y;
  const monitorRight = monitor.x + monitor.width;
  const monitorBottom = monitor.y + monitor.height;

  if (toolbarPos.x >= monitorLeft + panel.width + gap) {
    return {
      left: toolbarPos.x - panel.width - gap,
      top: clamp(
        toolbarPos.y + TOOLBAR_GAP,
        monitorTop + gap,
        monitorBottom - panel.height - gap,
      ),
    };
  }

  return {
    left: clamp(
      toolbarPos.x,
      monitorLeft + gap,
      monitorRight - panel.width - gap,
    ),
    top: clamp(
      toolbarPos.y - panel.height - gap,
      monitorTop + gap,
      monitorBottom - panel.height - gap,
    ),
  };
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

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

export function clampRect(r: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds.x, Math.min(r.x, bounds.x + bounds.width));
  const y = Math.max(bounds.y, Math.min(r.y, bounds.y + bounds.height));
  const right = Math.max(bounds.x, Math.min(r.x + r.width, bounds.x + bounds.width));
  const bottom = Math.max(bounds.y, Math.min(r.y + r.height, bounds.y + bounds.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function moveRect(sel: Rect, origin: Point, p: Point, bounds: Rect): Rect {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const maxX = bounds.x + bounds.width - sel.width;
  const maxY = bounds.y + bounds.height - sel.height;

  return {
    x: clamp(sel.x + dx, bounds.x, maxX),
    y: clamp(sel.y + dy, bounds.y, maxY),
    width: sel.width,
    height: sel.height,
  };
}

export function resizeRect(
  sel: Rect,
  handle: HandleId,
  p: Point,
  bounds: Rect,
  minSize = 8,
): Rect {
  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;
  let left = sel.x;
  let top = sel.y;
  let right = sel.x + sel.width;
  let bottom = sel.y + sel.height;

  if (handle.includes("w")) {
    left = clamp(p.x, bounds.x, right - minSize);
  }
  if (handle.includes("e")) {
    right = clamp(p.x, left + minSize, boundsRight);
  }
  if (handle.includes("n")) {
    top = clamp(p.y, bounds.y, bottom - minSize);
  }
  if (handle.includes("s")) {
    bottom = clamp(p.y, top + minSize, boundsBottom);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function cursorForHandle(handle: HandleId): string {
  switch (handle) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
  }
}
