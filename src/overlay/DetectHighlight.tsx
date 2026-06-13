import { useOverlay } from "@/overlay/state";
import { ACCENT_COLOR_CSS_VAR, ACCENT_RGB_CSS_VAR } from "@/lib/colors";

const COLOR = ACCENT_COLOR_CSS_VAR;

export function DetectHighlight() {
  const r = useOverlay((s) => s.hoverRect);
  const hoverTarget = useOverlay((s) => s.hoverTarget);
  const cornerRadius = useOverlay((s) => s.cornerRadius);
  const mode = useOverlay((s) => s.mode);
  if (!r || mode !== "hover") return null;
  const effectiveRadius = hoverTarget === "window" ? cornerRadius : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.width,
        height: r.height,
        border: `1.5px solid ${COLOR}`,
        borderRadius: effectiveRadius,
        boxShadow: `0 0 14px rgba(${ACCENT_RGB_CSS_VAR}, 0.4)`,
        pointerEvents: "none",
      }}
    />
  );
}
