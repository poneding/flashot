import { useOverlay } from "@/overlay/state";

const COLOR = "#4ED1FF";
const LINE_LENGTH = 20; // 总长度
const LINE_THICKNESS = 1.5;
const CIRCLE_SIZE = 6;
const CIRCLE_BORDER = 1.5;

export function Crosshair() {
  const cursor = useOverlay((s) => s.cursor);
  const mode = useOverlay((s) => s.mode);
  if (!cursor || (mode !== "hover" && mode !== "dragging")) return null;

  const halfLength = LINE_LENGTH / 2;
  const halfThickness = LINE_THICKNESS / 2;
  // 圆圈的中心位置：内容区域的一半
  const halfCircle = CIRCLE_SIZE / 2;

  return (
    <>
      {/* 横线 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: LINE_LENGTH,
          height: LINE_THICKNESS,
          background: COLOR,
          pointerEvents: "none",
          transform: `translate(${cursor.x - halfLength}px, ${cursor.y - halfThickness}px)`,
          willChange: "transform",
        }}
      />
      {/* 竖线 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: LINE_THICKNESS,
          height: LINE_LENGTH,
          background: COLOR,
          pointerEvents: "none",
          transform: `translate(${cursor.x - halfThickness}px, ${cursor.y - halfLength}px)`,
          willChange: "transform",
        }}
      />
      {/* 中心圆圈 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          border: `${CIRCLE_BORDER}px solid ${COLOR}`,
          background: "rgba(0,0,0,0.5)",
          borderRadius: "50%",
          pointerEvents: "none",
          transform: `translate(${cursor.x - halfCircle}px, ${cursor.y - halfCircle}px)`,
          willChange: "transform",
        }}
      />
    </>
  );
}
