import { useOverlay } from "@/overlay/state";
import type { Rect } from "@/lib/types";

const DIM = "rgba(0,0,0,0.55)";

function rectStyle(r: Rect): React.CSSProperties {
  return {
    position: "absolute",
    left: r.x,
    top: r.y,
    width: r.width,
    height: r.height,
    background: DIM,
    pointerEvents: "none",
  };
}

export function DimMask() {
  const monitor = useOverlay((s) => s.monitorRect);
  const mode = useOverlay((s) => s.mode);
  const sel = useOverlay((s) => s.selection ?? s.hoverRect);
  if (!monitor) return null;
  // During scrolling capture we draw nothing — the user must see the live
  // app underneath, undimmed, to scroll it. The SelectionBox outline still
  // marks the capture region.
  if (mode === "scrollStarting" || mode === "scrolling") return null;
  if (!sel) {
    if (mode !== "hover" && mode !== "dragging" && mode !== "locked") return null;
    return <div data-dim-mask="full" style={rectStyle({ x: 0, y: 0, width: monitor.width, height: monitor.height })} />;
  }

  // Four rects around the selection
  const top: Rect = { x: 0, y: 0, width: monitor.width, height: sel.y };
  const bottom: Rect = {
    x: 0,
    y: sel.y + sel.height,
    width: monitor.width,
    height: monitor.height - (sel.y + sel.height),
  };
  const left: Rect = { x: 0, y: sel.y, width: sel.x, height: sel.height };
  const right: Rect = {
    x: sel.x + sel.width,
    y: sel.y,
    width: monitor.width - (sel.x + sel.width),
    height: sel.height,
  };
  const rects = [top, bottom, left, right].filter((r) => r.width > 0 && r.height > 0);
  if (rects.length === 0) return null;

  return (
    <>
      {rects.map((r, index) => (
        <div key={index} data-dim-mask="partial" style={rectStyle(r)} />
      ))}
    </>
  );
}
