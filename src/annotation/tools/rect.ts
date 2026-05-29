import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";
import { isSpotlightStyle, type StageSize } from "@/annotation/focus";

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
  const isSpotlight = isSpotlightStyle(activeStyle);

  currentRect = new Konva.Rect({
    x,
    y,
    width: 0,
    height: 0,
    fill: isSolid ? activeStyle.color : "rgba(0,0,0,0)",
    stroke: isSolid || isSpotlight ? undefined : activeStyle.color,
    strokeWidth: isSolid || isSpotlight ? 0 : activeStyle.strokeWidth,
    strokeScaleEnabled: false,
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

export function renderRectObject(obj: AnnotationObject): Konva.Rect;
export function renderRectObject(obj: AnnotationObject, stageSize: StageSize): Konva.Rect | Konva.Group;
export function renderRectObject(obj: AnnotationObject, stageSize?: StageSize): Konva.Rect | Konva.Group {
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? { x: 0, y: 0 };
  const transform = obj.transform;

  const x = Math.min(start.x, end.x) + transform.x;
  const y = Math.min(start.y, end.y) + transform.y;
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  const isSolid = obj.style.fill === "solid";
  const isSpotlight = isSpotlightStyle(obj.style);

  const node = new Konva.Rect({
    id: obj.id,
    draggable: true,
    x,
    y,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
    width,
    height,
    fill: isSolid ? obj.style.color : "rgba(0,0,0,0)",
    stroke: isSolid || isSpotlight ? undefined : obj.style.color,
    strokeWidth: isSolid || isSpotlight ? 0 : obj.style.strokeWidth,
    strokeScaleEnabled: false,
    cornerRadius: obj.style.cornerRadius ?? 0,
  });

  void stageSize;

  return node;
}
