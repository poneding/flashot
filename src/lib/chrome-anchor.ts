export type ChromeAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
  side: "below" | "above" | "overlap";
};

const GAP = 8;

export function computeChromeAnchor(
  selection: { x: number; y: number; width: number; height: number },
  monitor: { x: number; y: number; width: number; height: number },
  preferred: { width: number; height: number },
): ChromeAnchor {
  const width = Math.min(Math.max(selection.width, preferred.width), monitor.width);
  const height = preferred.height;

  // Try below.
  const belowY = selection.y + selection.height + GAP;
  if (belowY + height <= monitor.y + monitor.height) {
    const x = clamp(selection.x, monitor.x, monitor.x + monitor.width - width);
    return { x, y: belowY, width, height, side: "below" };
  }

  // Try above.
  const aboveY = selection.y - GAP - height;
  if (aboveY >= monitor.y) {
    const x = clamp(selection.x, monitor.x, monitor.x + monitor.width - width);
    return { x, y: aboveY, width, height, side: "above" };
  }

  // Overlap: bottom-aligned inside selection.
  const overlapY = Math.min(
    selection.y + selection.height - height,
    monitor.y + monitor.height - height,
  );
  const x = clamp(selection.x, monitor.x, monitor.x + monitor.width - width);
  return { x, y: Math.max(monitor.y, overlapY), width, height, side: "overlap" };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
