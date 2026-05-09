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
  const sel = useOverlay((s) => s.selection ?? s.hoverRect);
  if (!monitor) return null;

  // Whole-screen dim if no selection
  if (!sel) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: DIM,
          pointerEvents: "none",
        }}
      />
    );
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
  return (
    <>
      <div style={rectStyle(top)} />
      <div style={rectStyle(bottom)} />
      <div style={rectStyle(left)} />
      <div style={rectStyle(right)} />
    </>
  );
}
