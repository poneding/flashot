import Konva from "konva";
import { useAnnotation } from "@/annotation/store";
import { renderEllipseObject } from "@/annotation/tools/ellipse";
import { renderRectObject } from "@/annotation/tools/rect";
import type { AnnotationObject, AnnotationStyle, SpotlightShape } from "@/annotation/types";
import type { Point } from "@/lib/types";

const MIN_SPOTLIGHT_SIZE = 4;

let startX = 0;
let startY = 0;

export function spotlightShape(style: AnnotationStyle): SpotlightShape {
  return style.spotlightShape === "circle" ? "circle" : "rect";
}

export function spotlightEndPoint(start: Point, end: Point, shape: SpotlightShape): Point {
  if (shape !== "circle") return end;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  const xSign = dx < 0 ? -1 : 1;
  const ySign = dy < 0 ? -1 : 1;

  return {
    x: start.x + xSign * size,
    y: start.y + ySign * size,
  };
}

export function spotlightBounds(start: Point, end: Point, shape: SpotlightShape) {
  const normalizedEnd = spotlightEndPoint(start, end, shape);
  return {
    x: Math.min(start.x, normalizedEnd.x),
    y: Math.min(start.y, normalizedEnd.y),
    width: Math.abs(normalizedEnd.x - start.x),
    height: Math.abs(normalizedEnd.y - start.y),
    end: normalizedEnd,
  };
}

export function onSpotlightStart(x: number, y: number) {
  startX = x;
  startY = y;
}

export function onSpotlightMove(_x: number, _y: number) {
  // The shared focus mask renders the live preview.
}

export function onSpotlightEnd(x: number, y: number): AnnotationObject | null {
  const { activeStyle } = useAnnotation.getState();
  const shape = spotlightShape(activeStyle);
  const start = { x: startX, y: startY };
  const bounds = spotlightBounds(start, { x, y }, shape);

  if (bounds.width < MIN_SPOTLIGHT_SIZE && bounds.height < MIN_SPOTLIGHT_SIZE) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    type: "spotlight",
    start,
    end: bounds.end,
    style: { ...activeStyle, fill: "spotlight", spotlightShape: shape },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

export function renderSpotlightObject(obj: AnnotationObject): Konva.Rect | Konva.Ellipse {
  if (spotlightShape(obj.style) === "circle") {
    return renderEllipseObject({ ...obj, type: "ellipse" });
  }

  return renderRectObject({ ...obj, type: "rect" });
}
