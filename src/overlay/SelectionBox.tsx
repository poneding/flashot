import { useOverlay } from "@/overlay/state";
import { cursorForHandle, type HandleId } from "@/lib/geometry";
import { FLOATING_LABEL_BACKGROUND } from "@/lib/floating-surface";
import { SELECTION_COLOR } from "@/lib/colors";

const COLOR = SELECTION_COLOR;

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
  const colorPickerVisible = useOverlay((s) => s.colorPickerVisible);
  if (!r) return null;

  const hx = (x: number) => x - 4;
  const hy = (y: number) => y - 4;
  const handleCursor = (id: HandleId) => colorPickerVisible ? "crosshair" : cursorForHandle(id);
  const handle = (id: HandleId, left: number, top: number) => (
    <div
      style={{ ...handleStyle, left, top, cursor: handleCursor(id) }}
      data-handle={id}
    />
  );

  // Use `outline` instead of `border` so the line never paints INSIDE the
  // selection rect — critical for scrolling capture, which would otherwise
  // pick up the outline as static content in the captured top ROI.
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.width,
          height: r.height,
          outline: `1.5px solid ${COLOR}`,
          outlineOffset: 0,
          pointerEvents: "none",
        }}
      />
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
