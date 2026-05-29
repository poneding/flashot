import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";

let currentHighlight: Konva.Group | null = null;
let currentPoints: number[] = [];
let startX = 0;
let startY = 0;

type HighlightGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  relativePoints: number[];
  strokeWidth: number;
};

const HIGHLIGHT_EDGE_PADDING = 2;
const DEFAULT_HIGHLIGHT_OPACITY = 0.35;
const MIN_HIGHLIGHT_POINT_DISTANCE = 0.75;
const MIN_HIGHLIGHT_MASK_PIXEL_RATIO = 2;
const HIGHLIGHT_SMOOTHING_PASSES = 2;

function highlightOpacity(style: AnnotationStyle): number {
  return style.opacity ?? DEFAULT_HIGHLIGHT_OPACITY;
}

function highlightStrokeWidth(style: AnnotationStyle): number {
  return style.strokeWidth * 4;
}

function highlightCornerRadius(style: AnnotationStyle): number {
  return Math.max(0, style.cornerRadius ?? 0);
}

export function highlightMaskPixelRatio(pixelRatio: number): number {
  if (!Number.isFinite(pixelRatio)) return MIN_HIGHLIGHT_MASK_PIXEL_RATIO;
  return Math.max(MIN_HIGHLIGHT_MASK_PIXEL_RATIO, pixelRatio);
}

function shouldAppendPoint(points: number[], x: number, y: number): boolean {
  if (points.length < 2) return true;
  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];
  return Math.hypot(x - lastX, y - lastY) >= MIN_HIGHLIGHT_POINT_DISTANCE;
}

function compactPoints(points: number[]): number[] {
  if (points.length <= 4) return [...points];

  const compacted = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i += 2) {
    if (shouldAppendPoint(compacted, points[i], points[i + 1])) {
      compacted.push(points[i], points[i + 1]);
    }
  }
  compacted.push(points[points.length - 2], points[points.length - 1]);
  return compacted;
}

function chaikinSmooth(points: number[]): number[] {
  if (points.length <= 4) return [...points];

  const smoothed = [points[0], points[1]];
  for (let i = 0; i < points.length - 2; i += 2) {
    const x0 = points[i];
    const y0 = points[i + 1];
    const x1 = points[i + 2];
    const y1 = points[i + 3];
    smoothed.push(
      x0 * 0.75 + x1 * 0.25,
      y0 * 0.75 + y1 * 0.25,
      x0 * 0.25 + x1 * 0.75,
      y0 * 0.25 + y1 * 0.75,
    );
  }
  smoothed.push(points[points.length - 2], points[points.length - 1]);
  return smoothed;
}

function smoothHighlightPoints(points: number[]): number[] {
  let smoothed = compactPoints(points);
  for (let i = 0; i < HIGHLIGHT_SMOOTHING_PASSES; i++) {
    smoothed = chaikinSmooth(smoothed);
  }
  return smoothed;
}

function highlightGeometry(points: number[], style: AnnotationStyle): HighlightGeometry {
  const renderPoints = smoothHighlightPoints(points);
  const strokeWidth = highlightStrokeWidth(style);
  const pad = strokeWidth / 2 + HIGHLIGHT_EDGE_PADDING;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < renderPoints.length; i += 2) {
    minX = Math.min(minX, renderPoints[i]);
    minY = Math.min(minY, renderPoints[i + 1]);
    maxX = Math.max(maxX, renderPoints[i]);
    maxY = Math.max(maxY, renderPoints[i + 1]);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  const x = minX - pad;
  const y = minY - pad;
  const width = Math.max(1, maxX - minX + pad * 2);
  const height = Math.max(1, maxY - minY + pad * 2);
  const relativePoints = renderPoints.map((point, index) => point - (index % 2 === 0 ? x : y));

  return { x, y, width, height, relativePoints, strokeWidth };
}

export function highlightBasePosition(obj: AnnotationObject): { x: number; y: number } {
  const geometry = highlightGeometry(obj.points ?? [], obj.style);
  return { x: geometry.x, y: geometry.y };
}

function traceHighlightPath(ctx: CanvasRenderingContext2D, points: number[]) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  if (points.length < 4) {
    ctx.lineTo(points[0] + 0.01, points[1] + 0.01);
    return;
  }
  if (points.length === 4) {
    ctx.lineTo(points[2], points[3]);
    return;
  }
  for (let i = 2; i < points.length - 2; i += 2) {
    const midX = (points[i] + points[i + 2]) / 2;
    const midY = (points[i + 1] + points[i + 3]) / 2;
    ctx.quadraticCurveTo(points[i], points[i + 1], midX, midY);
  }
  ctx.lineTo(points[points.length - 2], points[points.length - 1]);
}

function traceRoundedSegment(
  ctx: CanvasRenderingContext2D,
  points: number[],
  strokeWidth: number,
  cornerRadius: number,
) {
  if (points.length < 4) return;
  const [x1, y1, x2, y2] = points;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return;

  const half = strokeWidth / 2;
  const radius = Math.max(0, Math.min(cornerRadius, half, length / 2));
  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.beginPath();
  ctx.moveTo(radius, -half);
  ctx.lineTo(length - radius, -half);
  if (radius > 0) {
    ctx.quadraticCurveTo(length, -half, length, -half + radius);
  } else {
    ctx.lineTo(length, -half);
  }
  ctx.lineTo(length, half - radius);
  if (radius > 0) {
    ctx.quadraticCurveTo(length, half, length - radius, half);
  } else {
    ctx.lineTo(length, half);
  }
  ctx.lineTo(radius, half);
  if (radius > 0) {
    ctx.quadraticCurveTo(0, half, 0, half - radius);
  } else {
    ctx.lineTo(0, half);
  }
  ctx.lineTo(0, -half + radius);
  if (radius > 0) {
    ctx.quadraticCurveTo(0, -half, radius, -half);
  } else {
    ctx.lineTo(0, -half);
  }
  ctx.closePath();
  ctx.restore();
}

function drawHighlightScene(context: Konva.Context, shape: Konva.Shape) {
  const points = shape.getAttr("highlightPoints") as number[] | undefined;
  if (!points?.length) return;

  const width = shape.width();
  const height = shape.height();
  const pixelRatio = highlightMaskPixelRatio(context.getCanvas().getPixelRatio());
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * pixelRatio));
  canvas.height = Math.max(1, Math.ceil(height * pixelRatio));

  const mask = canvas.getContext("2d");
  if (!mask) return;

  mask.imageSmoothingEnabled = true;
  mask.scale(pixelRatio, pixelRatio);
  mask.lineCap = "round";
  mask.lineJoin = "round";
  mask.lineWidth = shape.strokeWidth();
  mask.strokeStyle = "#000";
  mask.globalAlpha = 1;
  if (points.length === 4) {
    mask.fillStyle = "#000";
    traceRoundedSegment(mask, points, shape.strokeWidth(), shape.getAttr("highlightCornerRadius") as number);
    mask.fill();
  } else {
    traceHighlightPath(mask, points);
    mask.stroke();
  }

  mask.globalCompositeOperation = "source-in";
  mask.globalAlpha = shape.getAttr("highlightOpacity") as number;
  mask.fillStyle = shape.getAttr("highlightColor") as string;
  mask.fillRect(0, 0, width, height);

  context.drawImage(canvas, 0, 0, width, height);
}

function drawHighlightHit(context: Konva.Context, shape: Konva.Shape) {
  const points = shape.getAttr("highlightPoints") as number[] | undefined;
  if (!points?.length) return;

  const ctx = context._context;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = shape.strokeWidth();
  ctx.strokeStyle = shape.colorKey;
  if (points.length === 4) {
    ctx.fillStyle = shape.colorKey;
    traceRoundedSegment(ctx, points, shape.strokeWidth(), shape.getAttr("highlightCornerRadius") as number);
    ctx.fill();
  } else {
    traceHighlightPath(ctx, points);
    ctx.stroke();
  }
  ctx.restore();
}

function updateHighlightNode(
  node: Konva.Group,
  points: number[],
  style: AnnotationStyle,
  transform: AnnotationObject["transform"] = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
) {
  const geometry = highlightGeometry(points, style);
  const mask = node.findOne(".highlight-mask") as Konva.Shape | undefined;

  node.position({ x: geometry.x + transform.x, y: geometry.y + transform.y });
  node.width(geometry.width);
  node.height(geometry.height);
  node.scaleX(transform.scaleX);
  node.scaleY(transform.scaleY);
  node.rotation(transform.rotation);

  mask?.setAttrs({
    width: geometry.width,
    height: geometry.height,
    strokeWidth: geometry.strokeWidth,
    hitStrokeWidth: geometry.strokeWidth,
    highlightPoints: geometry.relativePoints,
    highlightColor: style.color,
    highlightOpacity: highlightOpacity(style),
    highlightCornerRadius: highlightCornerRadius(style),
  });
}

function createHighlightNode(
  id: string | undefined,
  points: number[],
  style: AnnotationStyle,
  transform?: AnnotationObject["transform"],
): Konva.Group {
  const geometry = highlightGeometry(points, style);
  const node = new Konva.Group({
    id,
    x: geometry.x + (transform?.x ?? 0),
    y: geometry.y + (transform?.y ?? 0),
    width: geometry.width,
    height: geometry.height,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    draggable: true,
  });
  node.add(new Konva.Shape({
    width: geometry.width,
    height: geometry.height,
    stroke: "#000",
    strokeWidth: geometry.strokeWidth,
    strokeEnabled: false,
    hitStrokeWidth: geometry.strokeWidth,
    lineCap: "round",
    lineJoin: "round",
    opacity: 1,
    globalCompositeOperation: "source-over",
    perfectDrawEnabled: false,
    name: "highlight-mask",
    highlightPoints: geometry.relativePoints,
    highlightColor: style.color,
    highlightOpacity: highlightOpacity(style),
    highlightCornerRadius: highlightCornerRadius(style),
    sceneFunc: drawHighlightScene,
    hitFunc: drawHighlightHit,
  }));
  return node;
}

export function onHighlightStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  startX = x;
  startY = y;
  currentPoints = [x, y];

  currentHighlight = createHighlightNode(undefined, currentPoints, activeStyle);
  currentHighlight.listening(false);
  layer.add(currentHighlight);
}

export function onHighlightMove(x: number, y: number) {
  if (!currentHighlight) return;
  const { activeStyle } = useAnnotation.getState();

  if (activeStyle.highlightMode === "straight") {
    currentPoints = [startX, startY, x, y];
  } else {
    if (!shouldAppendPoint(currentPoints, x, y)) return;
    currentPoints.push(x, y);
  }
  updateHighlightNode(currentHighlight, currentPoints, activeStyle);
  getLayer()?.batchDraw();
}

export function onHighlightEnd(x: number, y: number): AnnotationObject | null {
  if (!currentHighlight) return null;

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();

  let points: number[];
  if (activeStyle.highlightMode === "straight") {
    points = [startX, startY, x, y];
  } else {
    points = [...currentPoints];
  }

  if (points.length < 4) {
    currentHighlight.destroy();
    currentHighlight = null;
    currentPoints = [];
    return null;
  }

  updateHighlightNode(currentHighlight, points, activeStyle);
  currentHighlight.id(id);
  currentHighlight.listening(true);
  currentHighlight.draggable(true);

  const obj: AnnotationObject = {
    id,
    type: "highlight",
    points,
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentHighlight = null;
  currentPoints = [];
  return obj;
}

export function renderHighlightObject(obj: AnnotationObject): Konva.Group {
  return createHighlightNode(obj.id, obj.points ?? [], obj.style, obj.transform);
}
