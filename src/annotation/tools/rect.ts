import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

let startX = 0;
let startY = 0;
let currentRect: Konva.Rect | null = null;

export function onRectStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  startX = x;
  startY = y;

  const isSolid = activeStyle.fill === "solid";

  currentRect = new Konva.Rect({
    x,
    y,
    width: 0,
    height: 0,
    fill: isSolid ? activeStyle.color : undefined,
    stroke: isSolid ? undefined : activeStyle.color,
    strokeWidth: isSolid ? 0 : activeStyle.strokeWidth,
    cornerRadius: activeStyle.cornerRadius ?? 0,
    listening: false,
  });

  layer.add(currentRect);
  currentRect.moveToTop();
}

export function onRectMove(x: number, y: number) {
  if (!currentRect) return;

  const x1 = Math.min(startX, x);
  const y1 = Math.min(startY, y);
  const w = Math.abs(x - startX);
  const h = Math.abs(y - startY);

  currentRect.x(x1);
  currentRect.y(y1);
  currentRect.width(w);
  currentRect.height(h);

  getLayer()?.batchDraw();
}

export function onRectEnd(x: number, y: number): AnnotationObject | null {
  if (!currentRect) return null;

  const w = Math.abs(x - startX);
  const h = Math.abs(y - startY);

  if (w < 4 && h < 4) {
    currentRect.destroy();
    currentRect = null;
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();

  const obj: AnnotationObject = {
    id,
    type: "rect",
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentRect.id(id);
  currentRect.listening(true);
  currentRect.draggable(true);
  currentRect = null;

  return obj;
}

export function renderRectObject(obj: AnnotationObject): Konva.Rect {
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? { x: 0, y: 0 };

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  const isSolid = obj.style.fill === "solid";

  return new Konva.Rect({
    id: obj.id,
    draggable: true,
    ...obj.transform,
    x,
    y,
    width,
    height,
    fill: isSolid ? obj.style.color : undefined,
    stroke: isSolid ? undefined : obj.style.color,
    strokeWidth: isSolid ? 0 : obj.style.strokeWidth,
    cornerRadius: obj.style.cornerRadius ?? 0,
  });
}
