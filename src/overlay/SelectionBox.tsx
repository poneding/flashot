import { useOverlay } from "@/overlay/state";

const COLOR = "#4ED1FF";

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
  if (!r) return null;

  const hx = (x: number) => x - 4;
  const hy = (y: number) => y - 4;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.width,
          height: r.height,
          border: `1.5px solid ${COLOR}`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: r.x + 6,
          top: r.y - 22,
          background: "rgba(0,0,0,0.85)",
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
      {mode === "committed" && (
        <>
          <div style={{ ...handleStyle, left: hx(r.x), top: hy(r.y) }} data-handle="nw" />
          <div style={{ ...handleStyle, left: hx(r.x + r.width / 2), top: hy(r.y) }} data-handle="n" />
          <div style={{ ...handleStyle, left: hx(r.x + r.width), top: hy(r.y) }} data-handle="ne" />
          <div style={{ ...handleStyle, left: hx(r.x + r.width), top: hy(r.y + r.height / 2) }} data-handle="e" />
          <div style={{ ...handleStyle, left: hx(r.x + r.width), top: hy(r.y + r.height) }} data-handle="se" />
          <div style={{ ...handleStyle, left: hx(r.x + r.width / 2), top: hy(r.y + r.height) }} data-handle="s" />
          <div style={{ ...handleStyle, left: hx(r.x), top: hy(r.y + r.height) }} data-handle="sw" />
          <div style={{ ...handleStyle, left: hx(r.x), top: hy(r.y + r.height / 2) }} data-handle="w" />
        </>
      )}
    </>
  );
}
