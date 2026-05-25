import { useOverlay } from "@/overlay/state";
import { cursorForHandle, type HandleId } from "@/lib/geometry";
import { FLOATING_LABEL_BACKGROUND } from "@/lib/floating-surface";
import { SELECTION_COLOR } from "@/lib/colors";

const COLOR = SELECTION_COLOR;
const STROKE_WIDTH = 1.5;

const handleStyle: React.CSSProperties = {
  position: "absolute",
  width: 8,
  height: 8,
  background: COLOR,
  border: "1.5px solid white",
  borderRadius: 1,
  pointerEvents: "auto",
};

export function SelectionBox() {
  const r = useOverlay((s) => s.selection);
  const mode = useOverlay((s) => s.mode);
  const cornerRadius = useOverlay((s) => s.cornerRadius);
  const colorPickerVisible = useOverlay((s) => s.colorPickerVisible);
  if (!r) return null;

  const effectiveRadius = mode === "scrollStarting" || mode === "scrolling" ? 0 : cornerRadius;
  const halfStroke = STROKE_WIDTH / 2;
  const hx = (x: number) => x - 4;
  const hy = (y: number) => y - 4;
  const handleCursor = (id: HandleId) => colorPickerVisible ? "crosshair" : cursorForHandle(id);
  const handle = (id: HandleId, left: number, top: number) => (
    <div
      style={{ ...handleStyle, left, top, cursor: handleCursor(id) }}
      data-handle={id}
    />
  );

  return (
    <>
      <svg
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.width,
          height: r.height,
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        <rect
          x={-halfStroke}
          y={-halfStroke}
          width={r.width + STROKE_WIDTH}
          height={r.height + STROKE_WIDTH}
          rx={effectiveRadius}
          ry={effectiveRadius}
          fill="none"
          stroke={COLOR}
          strokeWidth={STROKE_WIDTH}
          shapeRendering="geometricPrecision"
        />
      </svg>
      {mode !== "scrollStarting" && mode !== "scrolling" && (
        <div
          style={{
            position: "absolute",
            left: r.x + 6,
            top: r.y - 22,
            background: FLOATING_LABEL_BACKGROUND,
            color: COLOR,
            padding: "2px 6px",
            fontSize: 11,
            borderRadius: 4,
            fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
            pointerEvents: "none",
          }}
        >
          {Math.round(r.width)} × {Math.round(r.height)}
        </div>
      )}
      {mode === "committed" && (
        <>
          {handle("nw", hx(r.x), hy(r.y))}
          {handle("n", hx(r.x + r.width / 2), hy(r.y))}
          {handle("ne", hx(r.x + r.width), hy(r.y))}
          {handle("e", hx(r.x + r.width), hy(r.y + r.height / 2))}
          {handle("se", hx(r.x + r.width), hy(r.y + r.height))}
          {handle("s", hx(r.x + r.width / 2), hy(r.y + r.height))}
          {handle("sw", hx(r.x), hy(r.y + r.height))}
          {handle("w", hx(r.x), hy(r.y + r.height / 2))}
        </>
      )}
    </>
  );
}
