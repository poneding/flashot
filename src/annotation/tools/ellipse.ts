import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

let startX = 0;
let startY = 0;
let currentEllipse: Konva.Ellipse | null = null;

export function onEllipseStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  startX = x;
  startY = y;

  const isSolid = activeStyle.fill === "solid";

  currentEllipse = new Konva.Ellipse({
    x,
    y,
    radiusX: 0,
    radiusY: 0,
    fill: isSolid ? activeStyle.color : "rgba(0,0,0,0)",
    stroke: isSolid ? undefined : activeStyle.color,
    strokeWidth: isSolid ? 0 : activeStyle.strokeWidth,
    strokeScaleEnabled: false,
    listening: false,
  });

  layer.add(currentEllipse);
  currentEllipse.moveToTop();
}

export function onEllipseMove(x: number, y: number) {
  if (!currentEllipse) return;

  const cx = (startX + x) / 2;
  const cy = (startY + y) / 2;
  const rx = Math.abs(x - startX) / 2;
  const ry = Math.abs(y - startY) / 2;

  currentEllipse.x(cx);
  currentEllipse.y(cy);
  currentEllipse.radiusX(rx);
  currentEllipse.radiusY(ry);

  getLayer()?.batchDraw();
}

export function onEllipseEnd(x: number, y: number): AnnotationObject | null {
  if (!currentEllipse) return null;

  const rx = Math.abs(x - startX) / 2;
  const ry = Math.abs(y - startY) / 2;

  if (rx * 2 < 4 && ry * 2 < 4) {
    currentEllipse.destroy();
    currentEllipse = null;
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();

  const obj: AnnotationObject = {
    id,
    type: "ellipse",
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentEllipse.id(id);
  currentEllipse.listening(true);
  currentEllipse.draggable(true);
  currentEllipse = null;

  return obj;
}

export function renderEllipseObject(obj: AnnotationObject): Konva.Ellipse {
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? { x: 0, y: 0 };
  const transform = obj.transform;

  const cx = (start.x + end.x) / 2 + transform.x;
  const cy = (start.y + end.y) / 2 + transform.y;
  const rx = Math.abs(end.x - start.x) / 2;
  const ry = Math.abs(end.y - start.y) / 2;

  const isSolid = obj.style.fill === "solid";

  return new Konva.Ellipse({
    id: obj.id,
    draggable: true,
    x: cx,
    y: cy,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
    radiusX: rx,
    radiusY: ry,
    fill: isSolid ? obj.style.color : "rgba(0,0,0,0)",
    stroke: isSolid ? undefined : obj.style.color,
    strokeWidth: isSolid ? 0 : obj.style.strokeWidth,
    strokeScaleEnabled: false,
  });
}
