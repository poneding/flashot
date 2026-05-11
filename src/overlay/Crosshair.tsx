import { useOverlay } from "@/overlay/state";

const COLOR = "#4ED1FF";

export function Crosshair() {
  const cursor = useOverlay((s) => s.cursor);
  const mode = useOverlay((s) => s.mode);
  if (!cursor || (mode !== "hover" && mode !== "dragging")) return null;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: cursor.x - 8,
          top: cursor.y,
          width: 16,
          height: 1.5,
          background: COLOR,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: cursor.x,
          top: cursor.y - 8,
          width: 1.5,
          height: 16,
          background: COLOR,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: cursor.x - 3,
          top: cursor.y - 3,
          width: 6,
          height: 6,
          border: `1.5px solid ${COLOR}`,
          background: "rgba(0,0,0,0.5)",
          borderRadius: "50%",
          pointerEvents: "none",
        }}
      />
    </>
  );
}
