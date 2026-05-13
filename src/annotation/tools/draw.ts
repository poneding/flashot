import Konva from "konva";
import getStroke from "perfect-freehand";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";

let currentPoints: number[][] = [];
let currentPath: Konva.Path | null = null;

function getSvgPathFromStroke(stroke: number[][]): string {
  if (stroke.length < 2) return "";
  const d = [`M ${stroke[0][0]} ${stroke[0][1]}`];
  for (let i = 1; i < stroke.length; i++) {
    const [x, y] = stroke[i];
    d.push(`L ${x} ${y}`);
  }
  d.push("Z");
  return d.join(" ");
}

function renderStroke(points: number[][], style: AnnotationStyle): string {
  const stroke = getStroke(points, {
    size: style.strokeWidth * 2,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  });
  return getSvgPathFromStroke(stroke);
}

export function onDrawStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  currentPoints = [[x, y, 0.5]];

  currentPath = new Konva.Path({
    data: "",
    fill: activeStyle.color,
    listening: false,
  });
  layer.add(currentPath);
  currentPath.moveToTop();
}

export function onDrawMove(x: number, y: number) {
  if (!currentPath) return;

  const { activeStyle } = useAnnotation.getState();
  currentPoints.push([x, y, 0.5]);
  const pathData = renderStroke(currentPoints, activeStyle);
  currentPath.data(pathData);
  getLayer()?.batchDraw();
}

export function onDrawEnd(): AnnotationObject | null {
  if (!currentPath || currentPoints.length < 2) {
    currentPath?.destroy();
    currentPath = null;
    currentPoints = [];
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();
  const flatPoints = currentPoints.flat();

  const obj: AnnotationObject = {
    id,
    type: "draw",
    points: flatPoints,
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentPath.id(id);
  currentPath.listening(true);
  currentPath = null;
  currentPoints = [];

  return obj;
}

export function renderDrawObject(obj: AnnotationObject): Konva.Path {
  const points: number[][] = [];
  for (let i = 0; i < (obj.points?.length ?? 0); i += 3) {
    points.push([obj.points![i], obj.points![i + 1], obj.points![i + 2]]);
  }
  const pathData = renderStroke(points, obj.style);
  return new Konva.Path({
    id: obj.id,
    data: pathData,
    fill: obj.style.color,
    ...obj.transform,
  });
}
