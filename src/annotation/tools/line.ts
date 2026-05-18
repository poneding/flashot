import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";
import type { Point } from "@/lib/types";

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

function generateQuadraticPoints(start: Point, control: Point, end: Point): number[] {
  const points: number[] = [];
  const segments = 32;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    points.push(
      mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
      mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
    );
  }
  return points;
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
    y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
  };
}

function quadraticTangent(start: Point, control: Point, end: Point, t: number): Point {
  return {
    x: 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x),
    y: 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y),
  };
}

function generateWavyQuadraticPoints(start: Point, control: Point, end: Point): number[] {
  const wavelength = 28;
  const amplitude = 2;
  const lengthSamples = 32;
  let length = 0;
  let prev = start;

  for (let i = 1; i <= lengthSamples; i++) {
    const point = quadraticPoint(start, control, end, i / lengthSamples);
    length += Math.hypot(point.x - prev.x, point.y - prev.y);
    prev = point;
  }

  const segments = Math.max(Math.round(length / 3), 10);
  const points: number[] = [];
  let distance = 0;
  prev = start;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = quadraticPoint(start, control, end, t);
    if (i > 0) distance += Math.hypot(point.x - prev.x, point.y - prev.y);

    const tangent = quadraticTangent(start, control, end, t);
    const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
    const offset = Math.sin((distance / wavelength) * Math.PI * 2) * amplitude;
    points.push(
      point.x + (-tangent.y / tangentLength) * offset,
      point.y + (tangent.x / tangentLength) * offset,
    );
    prev = point;
  }

  return points;
}

export function lineControlPoint(obj: AnnotationObject): Point {
  if (obj.points && obj.points.length >= 2) {
    return { x: obj.points[0], y: obj.points[1] };
  }
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? start;
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}

function createArrowHead(x: number, y: number, angle: number, style: AnnotationStyle): Konva.Shape {
  const size = Math.max(style.strokeWidth * 3, 10);

  if (style.arrowStyle === "filled-triangle") {
    const narrowAngle = Math.PI / 8;
    const len = Math.max(size * 1.25, 12);
    const p1x = x - len * Math.cos(angle - narrowAngle);
    const p1y = y - len * Math.sin(angle - narrowAngle);
    const p2x = x - len * Math.cos(angle + narrowAngle);
    const p2y = y - len * Math.sin(angle + narrowAngle);

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

function effectiveLineShape(objOrType: AnnotationObject | "line" | "arrow", style: AnnotationStyle) {
  const type = typeof objOrType === "string" ? objOrType : objOrType.type;
  return type === "arrow" ? "straight" : style.lineShape;
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

  if (effectiveLineShape(activeTool === "arrow" ? "arrow" : "line", activeStyle) === "wavy") {
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

  const obj: AnnotationObject = {
    id,
    type: "line",
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentGroup.id(id);
  currentGroup.listening(true);
  currentGroup.draggable(false);
  currentGroup.position({ x: startX, y: startY });
  buildLineObjectChildren(currentGroup, obj);

  currentGroup = null;
  return obj;
}

function buildLineObjectChildren(group: Konva.Group, obj: AnnotationObject) {
  group.destroyChildren();
  const { start, end, style } = obj;
  const x1 = start!.x, y1 = start!.y, x2 = end!.x, y2 = end!.y;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const control = lineControlPoint(obj);
  const localControl = { x: control.x - x1, y: control.y - y1 };
  const lineShape = effectiveLineShape(obj, style);

  let points: number[];
  if (obj.points && obj.points.length >= 2 && lineShape === "wavy") {
    points = generateWavyQuadraticPoints({ x: 0, y: 0 }, localControl, { x: dx, y: dy });
  } else if (obj.points && obj.points.length >= 2) {
    points = generateQuadraticPoints({ x: 0, y: 0 }, localControl, { x: dx, y: dy });
  } else if (lineShape === "wavy") {
    points = generateWavyPoints(0, 0, dx, dy);
  } else {
    points = [0, 0, dx, dy];
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

  const endAngle = obj.points && obj.points.length >= 2
    ? Math.atan2(dy - localControl.y, dx - localControl.x)
    : Math.atan2(dy, dx);
  const startAngle = obj.points && obj.points.length >= 2
    ? Math.atan2(localControl.y, localControl.x)
    : Math.atan2(dy, dx);
  if (style.arrow === "end" || style.arrow === "both") {
    group.add(createArrowHead(dx, dy, endAngle, style));
  }
  if (style.arrow === "start" || style.arrow === "both") {
    group.add(createArrowHead(0, 0, startAngle + Math.PI, style));
  }
}

export function updateLineObjectNode(group: Konva.Group, obj: AnnotationObject) {
  buildLineObjectChildren(group, obj);
}

export function renderLineObject(obj: AnnotationObject): Konva.Group {
  const transform = obj.transform;
  const { start } = obj;
  const x1 = start!.x, y1 = start!.y;

  const group = new Konva.Group({
    id: obj.id,
    draggable: false,
    x: x1 + transform.x,
    y: y1 + transform.y,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
  });

  buildLineObjectChildren(group, obj);

  return group;
}
