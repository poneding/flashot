import { useOverlay } from "@/overlay/state";
import { SELECTION_COLOR } from "@/lib/colors";

const COLOR = SELECTION_COLOR;

export function DetectHighlight() {
  const r = useOverlay((s) => s.hoverRect);
  const mode = useOverlay((s) => s.mode);
  if (!r || mode !== "hover") return null;
  return (
    <div
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.width,
        height: r.height,
        border: `1.5px solid ${COLOR}`,
        background: "rgba(78,209,255,0.06)",
        boxShadow: `0 0 14px ${COLOR}66`,
        pointerEvents: "none",
      }}
    />
  );
}
