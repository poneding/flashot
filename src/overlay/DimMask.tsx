import { useOverlay } from "@/overlay/state";

const DIM = "rgba(0,0,0,0.55)";
const MASK_ID = "flashot-dim-hole";

export function DimMask() {
  const monitor = useOverlay((s) => s.monitorRect);
  const mode = useOverlay((s) => s.mode);
  const sel = useOverlay((s) => s.selection ?? s.hoverRect);
  const cornerRadius = useOverlay((s) => s.cornerRadius);
  if (!monitor) return null;
  if (mode === "scrollStarting" || mode === "scrolling") return null;
  if (!sel) {
    if (mode !== "hover" && mode !== "dragging" && mode !== "locked") return null;
    return (
      <div
        data-dim-mask="full"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: monitor.width,
          height: monitor.height,
          background: DIM,
          pointerEvents: "none",
        }}
      />
    );
  }

  return (
    <svg
      data-dim-mask="partial"
      width={monitor.width}
      height={monitor.height}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        pointerEvents: "none",
      }}
    >
      <defs>
        <mask id={MASK_ID}>
          <rect x="0" y="0" width={monitor.width} height={monitor.height} fill="white" />
          <rect
            x={sel.x}
            y={sel.y}
            width={sel.width}
            height={sel.height}
            rx={cornerRadius}
            ry={cornerRadius}
            fill="black"
          />
        </mask>
      </defs>
      <rect x="0" y="0" width={monitor.width} height={monitor.height} fill={DIM} mask={`url(#${MASK_ID})`} />
    </svg>
  );
}
