import Konva from "konva";
import { getStroke } from "perfect-freehand";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";

let currentPoints: number[] = [];
let currentPath: Konva.Path | null = null;
let pendingPreviewFrame: number | null = null;

const MIN_DRAW_POINT_DISTANCE = 0.75;
const FREEHAND_OPTIONS = {
  thinning: 0,
  smoothing: 0.72,
  streamline: 0.62,
  simulatePressure: false,
  start: { cap: true },
  end: { cap: true },
  last: true,
};

function shouldAppendPoint(points: number[], x: number, y: number): boolean {
  if (points.length < 2) return true;
  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];
  return Math.hypot(x - lastX, y - lastY) >= MIN_DRAW_POINT_DISTANCE;
}

function average(a: number, b: number): number {
  return (a + b) / 2;
}

function flatPointsToStrokeInput(points: number[]): [number, number, number][] {
  const input: [number, number, number][] = [];
  for (let i = 0; i < points.length; i += 2) {
    input.push([points[i], points[i + 1], 0.5]);
  }
  return input;
}

function svgPathFromStroke(stroke: number[][]): string {
  const len = stroke.length;
  if (len < 4) return "";

  let a = stroke[0];
  let b = stroke[1];
  const c = stroke[2];
  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`;

  for (let i = 2, max = len - 1; i < max; i++) {
    a = stroke[i];
    b = stroke[i + 1];
    result += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }

  return `${result}Z`;
}

function drawPathData(points: number[], style: AnnotationStyle): string {
  const stroke = getStroke(flatPointsToStrokeInput(points), {
    ...FREEHAND_OPTIONS,
    size: style.strokeWidth,
  });
  return svgPathFromStroke(stroke);
}

function createDrawPath(id: string | undefined, points: number[], style: AnnotationStyle, transform?: AnnotationObject["transform"]): Konva.Path {
  return new Konva.Path({
    id,
    data: drawPathData(points, style),
    fill: style.color,
    strokeEnabled: false,
    perfectDrawEnabled: true,
    draggable: true,
    ...(transform ?? {}),
  });
}

function requestPreviewFrame(callback: FrameRequestCallback): number {
  if (globalThis.requestAnimationFrame) {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number;
}

function cancelPreviewFrame(frame: number) {
  if (globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame(frame);
    return;
  }
  globalThis.clearTimeout(frame);
}

function applyCurrentPathData() {
  if (!currentPath) return;
  const { activeStyle } = useAnnotation.getState();
  currentPath.data(drawPathData(currentPoints, activeStyle));
  getLayer()?.batchDraw();
}

function schedulePreviewDraw() {
  if (pendingPreviewFrame !== null) return;
  pendingPreviewFrame = requestPreviewFrame(() => {
    pendingPreviewFrame = null;
    applyCurrentPathData();
  });
}

function flushPreviewDraw() {
  if (pendingPreviewFrame !== null) {
    cancelPreviewFrame(pendingPreviewFrame);
    pendingPreviewFrame = null;
  }
  applyCurrentPathData();
}

export function onDrawStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  if (pendingPreviewFrame !== null) {
    cancelPreviewFrame(pendingPreviewFrame);
    pendingPreviewFrame = null;
  }
  const { activeStyle } = useAnnotation.getState();
  currentPoints = [x, y];

  currentPath = createDrawPath(undefined, currentPoints, activeStyle);
  currentPath.listening(false);
  layer.add(currentPath);
  if (currentPath.getParent()) currentPath.moveToTop();
}

export function onDrawMove(x: number, y: number) {
  if (!currentPath) return;
  if (!shouldAppendPoint(currentPoints, x, y)) return;

  currentPoints.push(x, y);
  schedulePreviewDraw();
}

export function onDrawEnd(): AnnotationObject | null {
  if (!currentPath || currentPoints.length < 4) {
    if (pendingPreviewFrame !== null) {
      cancelPreviewFrame(pendingPreviewFrame);
      pendingPreviewFrame = null;
    }
    currentPath?.destroy();
    currentPath = null;
    currentPoints = [];
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();
  flushPreviewDraw();

  const obj: AnnotationObject = {
    id,
    type: "draw",
    points: [...currentPoints],
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentPath.id(id);
  currentPath.listening(true);
  currentPath.draggable(true);
  currentPath = null;
  currentPoints = [];

  return obj;
}

export function renderDrawObject(obj: AnnotationObject): Konva.Path {
  return createDrawPath(obj.id, obj.points ?? [], obj.style, obj.transform);
}
