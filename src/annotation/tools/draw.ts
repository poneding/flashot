import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

let currentPoints: number[] = [];
let currentLine: Konva.Line | null = null;

export function onDrawStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  currentPoints = [x, y];

  currentLine = new Konva.Line({
    points: currentPoints,
    stroke: activeStyle.color,
    strokeWidth: activeStyle.strokeWidth,
    lineCap: "round",
    lineJoin: "round",
    listening: false,
  });
  layer.add(currentLine);
  currentLine.moveToTop();
}

export function onDrawMove(x: number, y: number) {
  if (!currentLine) return;

  currentPoints.push(x, y);
  currentLine.points(currentPoints);
  getLayer()?.batchDraw();
}

export function onDrawEnd(): AnnotationObject | null {
  if (!currentLine || currentPoints.length < 4) {
    currentLine?.destroy();
    currentLine = null;
    currentPoints = [];
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();

  const obj: AnnotationObject = {
    id,
    type: "draw",
    points: [...currentPoints],
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentLine.id(id);
  currentLine.listening(true);
  currentLine.draggable(true);
  currentLine = null;
  currentPoints = [];

  return obj;
}

export function renderDrawObject(obj: AnnotationObject): Konva.Line {
  return new Konva.Line({
    id: obj.id,
    points: obj.points ?? [],
    stroke: obj.style.color,
    strokeWidth: obj.style.strokeWidth,
    lineCap: "round",
    lineJoin: "round",
    draggable: true,
    ...obj.transform,
  });
}
