import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

let currentLine: Konva.Line | null = null;
let currentPoints: number[] = [];
let startX = 0;
let startY = 0;

export function onHighlightStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  startX = x;
  startY = y;
  currentPoints = [x, y];

  currentLine = new Konva.Line({
    points: currentPoints,
    stroke: activeStyle.color,
    strokeWidth: activeStyle.strokeWidth * 4,
    opacity: activeStyle.opacity ?? 0.35,
    lineCap: "round",
    lineJoin: "round",
    globalCompositeOperation: "multiply",
    listening: false,
  });
  layer.add(currentLine);
}

export function onHighlightMove(x: number, y: number) {
  if (!currentLine) return;
  const { activeStyle } = useAnnotation.getState();

  if (activeStyle.highlightMode === "straight") {
    currentLine.points([startX, startY, x, y]);
  } else {
    currentPoints.push(x, y);
    currentLine.points([...currentPoints]);
  }
  getLayer()?.batchDraw();
}

export function onHighlightEnd(x: number, y: number): AnnotationObject | null {
  if (!currentLine) return null;

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();

  let points: number[];
  if (activeStyle.highlightMode === "straight") {
    points = [startX, startY, x, y];
  } else {
    points = [...currentPoints];
  }

  if (points.length < 4) {
    currentLine.destroy();
    currentLine = null;
    currentPoints = [];
    return null;
  }

  currentLine.id(id);
  currentLine.listening(true);
  currentLine.draggable(true);

  const obj: AnnotationObject = {
    id,
    type: "highlight",
    points,
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentLine = null;
  currentPoints = [];
  return obj;
}

export function renderHighlightObject(obj: AnnotationObject): Konva.Line {
  return new Konva.Line({
    id: obj.id,
    points: obj.points ?? [],
    stroke: obj.style.color,
    strokeWidth: obj.style.strokeWidth * 4,
    opacity: obj.style.opacity ?? 0.35,
    lineCap: "round",
    lineJoin: "round",
    globalCompositeOperation: "multiply",
    draggable: true,
    ...obj.transform,
  });
}
