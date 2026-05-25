import { useOverlay } from "@/overlay/state";
import type { Rect } from "@/lib/types";
import { useId } from "react";

const DIM = "rgba(0,0,0,0.55)";

export function DimMask() {
  const maskPrefix = useId().replace(/:/g, "");
  const monitor = useOverlay((s) => s.monitorRect);
  const mode = useOverlay((s) => s.mode);
  const selection = useOverlay((s) => s.selection);
  const hoverRect = useOverlay((s) => s.hoverRect);
  const hoverTarget = useOverlay((s) => s.hoverTarget);
  const sel = selection ?? hoverRect;
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

  const effectiveRadius = selection || hoverTarget === "window" ? cornerRadius : 0;
  const radius = Math.max(0, Math.min(effectiveRadius, sel.width / 2, sel.height / 2));
  const right = sel.x + sel.width;
  const bottom = sel.y + sel.height;

  return (
    <>
      <DimTile name="top" rect={{ x: 0, y: 0, width: monitor.width, height: Math.max(0, sel.y) }} />
      <DimTile
        name="bottom"
        rect={{ x: 0, y: bottom, width: monitor.width, height: Math.max(0, monitor.height - bottom) }}
      />
      <DimTile name="left" rect={{ x: 0, y: sel.y, width: Math.max(0, sel.x), height: sel.height }} />
      <DimTile
        name="right"
        rect={{ x: right, y: sel.y, width: Math.max(0, monitor.width - right), height: sel.height }}
      />
      {radius > 0 && (
        <>
          <CornerMask id={`${maskPrefix}-tl`} corner="tl" x={sel.x} y={sel.y} radius={radius} />
          <CornerMask id={`${maskPrefix}-tr`} corner="tr" x={right - radius} y={sel.y} radius={radius} />
          <CornerMask id={`${maskPrefix}-bl`} corner="bl" x={sel.x} y={bottom - radius} radius={radius} />
          <CornerMask id={`${maskPrefix}-br`} corner="br" x={right - radius} y={bottom - radius} radius={radius} />
        </>
      )}
    </>
  );
}

function DimTile({ name, rect }: { name: string; rect: Rect }) {
  return (
    <div
      data-dim-mask-tile={name}
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height),
        background: DIM,
        pointerEvents: "none",
      }}
    />
  );
}

function CornerMask({
  id,
  corner,
  x,
  y,
  radius,
}: {
  id: string;
  corner: "tl" | "tr" | "bl" | "br";
  x: number;
  y: number;
  radius: number;
}) {
  const cx = corner === "tl" || corner === "bl" ? radius : 0;
  const cy = corner === "tl" || corner === "tr" ? radius : 0;

  return (
    <svg
      data-dim-mask-corner={corner}
      width={radius}
      height={radius}
      viewBox={`0 0 ${radius} ${radius}`}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: radius,
        height: radius,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <defs>
        <mask id={id}>
          <rect x="0" y="0" width={radius} height={radius} fill="white" />
          <circle cx={cx} cy={cy} r={radius} fill="black" />
        </mask>
      </defs>
      <rect x="0" y="0" width={radius} height={radius} fill={DIM} mask={`url(#${id})`} />
    </svg>
  );
}
