import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";

let currentGroup: Konva.Group | null = null;
let startX = 0;
let startY = 0;

function generateWavyPoints(x1: number, y1: number, x2: number, y2: number): number[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const wavelength = 28;
  const segments = Math.max(Math.round(length / 3), 10);
  const amplitude = 2;
  const angle = Math.atan2(dy, dx);
  const points: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const baseX = x1 + dx * t;
    const baseY = y1 + dy * t;
    const dist = t * length;
    const offset = Math.sin((dist / wavelength) * Math.PI * 2) * amplitude;
    points.push(baseX + Math.cos(angle + Math.PI / 2) * offset);
    points.push(baseY + Math.sin(angle + Math.PI / 2) * offset);
  }
  return points;
}

function createArrowHead(x: number, y: number, angle: number, style: AnnotationStyle): Konva.Shape {
  const size = style.strokeWidth * 3;

  if (style.arrowStyle === "filled-triangle") {
    return new Konva.RegularPolygon({
      x,
      y,
      sides: 3,
      radius: size,
      fill: style.color,
      rotation: (angle * 180) / Math.PI + 90,
    });
  }

  if (style.arrowStyle === "pointed") {
    const narrowAngle = Math.PI / 8;
    const p1x = x - size * 1.2 * Math.cos(angle - narrowAngle);
    const p1y = y - size * 1.2 * Math.sin(angle - narrowAngle);
    const p2x = x - size * 1.2 * Math.cos(angle + narrowAngle);
    const p2y = y - size * 1.2 * Math.sin(angle + narrowAngle);
    return new Konva.Line({
      points: [p1x, p1y, x, y, p2x, p2y],
      stroke: style.color,
      strokeWidth: style.strokeWidth * 0.8,
      lineCap: "round",
      lineJoin: "miter",
      closed: true,
      fill: style.color,
    });
  }

  // v-shape (default)
  const p1x = x - size * Math.cos(angle - Math.PI / 6);
  const p1y = y - size * Math.sin(angle - Math.PI / 6);
  const p2x = x - size * Math.cos(angle + Math.PI / 6);
  const p2y = y - size * Math.sin(angle + Math.PI / 6);

  return new Konva.Line({
    points: [p1x, p1y, x, y, p2x, p2y],
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    lineJoin: "round",
  });
}

function getDashPattern(style: AnnotationStyle): number[] | undefined {
  if (style.lineStyle === "dotted") return [2, style.strokeWidth * 2];
  if (style.lineStyle === "dashed") return [style.strokeWidth * 3, style.strokeWidth * 2];
  return undefined;
}

export function onLineStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  startX = x;
  startY = y;
  const { activeStyle } = useAnnotation.getState();

  currentGroup = new Konva.Group({ listening: false });

  const line = new Konva.Line({
    points: [x, y, x, y],
    stroke: activeStyle.color,
    strokeWidth: activeStyle.strokeWidth,
    lineCap: "round",
    dash: getDashPattern(activeStyle),
    name: "main-line",
  });
  currentGroup.add(line);
  layer.add(currentGroup);
}

export function onLineMove(x: number, y: number) {
  if (!currentGroup) return;
  const { activeStyle, activeTool } = useAnnotation.getState();
  const mainLine = currentGroup.findOne(".main-line") as Konva.Line;
  if (!mainLine) return;

  if (activeStyle.lineShape === "wavy") {
    const wavyPoints = generateWavyPoints(startX, startY, x, y);
    mainLine.points(wavyPoints);
    mainLine.tension(0);
  } else {
    mainLine.points([startX, startY, x, y]);
    mainLine.tension(0);
  }
  mainLine.dash(getDashPattern(activeStyle) ?? []);

  // Show arrowhead preview during drawing
  currentGroup.find(".temp-arrow").forEach((n) => n.destroy());
  const showArrow = activeTool === "arrow" || activeStyle.arrow === "end" || activeStyle.arrow === "both";
  const showStart = activeStyle.arrow === "start" || activeStyle.arrow === "both";
  if (showArrow || showStart) {
    const angle = Math.atan2(y - startY, x - startX);
    if (showArrow) {
      const head = createArrowHead(x, y, angle, activeStyle);
      head.name("temp-arrow");
      currentGroup.add(head);
    }
    if (showStart) {
      const tail = createArrowHead(startX, startY, angle + Math.PI, activeStyle);
      tail.name("temp-arrow");
      currentGroup.add(tail);
    }
  }

  getLayer()?.batchDraw();
}

export function onLineEnd(x: number, y: number): AnnotationObject | null {
  if (!currentGroup || (Math.abs(x - startX) < 4 && Math.abs(y - startY) < 4)) {
    currentGroup?.destroy();
    currentGroup = null;
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();

  // Remove preview arrowheads
  currentGroup.find(".temp-arrow").forEach((n) => n.destroy());

  const angle = Math.atan2(y - startY, x - startX);
  if (activeStyle.arrow === "end" || activeStyle.arrow === "both") {
    currentGroup.add(createArrowHead(x, y, angle, activeStyle));
  }
  if (activeStyle.arrow === "start" || activeStyle.arrow === "both") {
    currentGroup.add(createArrowHead(startX, startY, angle + Math.PI, activeStyle));
  }

  currentGroup.id(id);
  currentGroup.listening(true);
  currentGroup.draggable(true);

  const obj: AnnotationObject = {
    id,
    type: "line",
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentGroup = null;
  return obj;
}

export function renderLineObject(obj: AnnotationObject): Konva.Group {
  const group = new Konva.Group({ id: obj.id, draggable: true, ...obj.transform });
  const { start, end, style } = obj;
  const x1 = start!.x, y1 = start!.y, x2 = end!.x, y2 = end!.y;

  let points: number[];
  if (style.lineShape === "wavy") {
    points = generateWavyPoints(x1, y1, x2, y2);
  } else {
    points = [x1, y1, x2, y2];
  }

  const line = new Konva.Line({
    points,
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    dash: getDashPattern(style),
    name: "main-line",
  });
  group.add(line);

  const angle = Math.atan2(y2 - y1, x2 - x1);
  if (style.arrow === "end" || style.arrow === "both") {
    group.add(createArrowHead(x2, y2, angle, style));
  }
  if (style.arrow === "start" || style.arrow === "both") {
    group.add(createArrowHead(x1, y1, angle + Math.PI, style));
  }

  return group;
}
