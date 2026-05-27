import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { MagnifierRenderContext } from "@/annotation/magnifierContext";
import type { AnnotationObject, AnnotationStyle, MagnifierShape } from "@/annotation/types";

const MIN_LENS_SIZE = 12;

let startX = 0;
let startY = 0;
let currentLens: Konva.Rect | null = null;

function boundsForObject(obj: AnnotationObject) {
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? start;
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function magnifierShape(style: AnnotationStyle): MagnifierShape {
  return style.magnifierShape === "rounded-rect" ? "rounded-rect" : "circle";
}

function magnifierZoom(style: AnnotationStyle): number {
  const zoom = style.magnifierZoom ?? 1.5;
  return Number.isFinite(zoom) ? Math.max(1.1, Math.min(2, zoom)) : 1.5;
}

function borderColor(style: AnnotationStyle): string {
  return style.magnifierBorderColor ?? style.color;
}

function borderWidth(style: AnnotationStyle): number {
  const width = style.magnifierBorderWidth ?? 2;
  return Number.isFinite(width) ? Math.max(1, width) : 2;
}

function cornerRadius(style: AnnotationStyle): number {
  const radius = style.magnifierCornerRadius ?? 12;
  return Number.isFinite(radius) ? Math.max(0, radius) : 12;
}

export function onMagnifierStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  startX = x;
  startY = y;

  currentLens = new Konva.Rect({
    x,
    y,
    width: 0,
    height: 0,
    stroke: borderColor(activeStyle),
    strokeWidth: borderWidth(activeStyle),
    dash: [4, 4],
    listening: false,
  });

  layer.add(currentLens);
  currentLens.moveToTop();
}

export function onMagnifierMove(x: number, y: number) {
  if (!currentLens) return;

  currentLens.setAttrs({
    x: Math.min(startX, x),
    y: Math.min(startY, y),
    width: Math.abs(x - startX),
    height: Math.abs(y - startY),
  });
  getLayer()?.batchDraw();
}

export function onMagnifierEnd(x: number, y: number): AnnotationObject | null {
  if (!currentLens) return null;

  const width = Math.abs(x - startX);
  const height = Math.abs(y - startY);
  currentLens.destroy();
  currentLens = null;

  if (width < MIN_LENS_SIZE || height < MIN_LENS_SIZE) return null;

  return {
    id: crypto.randomUUID(),
    type: "magnifier",
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...useAnnotation.getState().activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

function addMagnifiedImage(clip: Konva.Group, bounds: ReturnType<typeof boundsForObject>, context: MagnifierRenderContext, zoom: number) {
  const sourceWidth = context.stageSize.width * zoom;
  const sourceHeight = context.stageSize.height * zoom;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  clip.add(new Konva.Image({
    name: "magnifier-image",
    image: context.sourceImage,
    x: bounds.width / 2 - centerX * zoom,
    y: bounds.height / 2 - centerY * zoom,
    width: sourceWidth,
    height: sourceHeight,
    listening: false,
  }));
}

export function renderMagnifierObject(obj: AnnotationObject, context?: MagnifierRenderContext | null): Konva.Group {
  const bounds = boundsForObject(obj);
  const transform = obj.transform;
  const shape = magnifierShape(obj.style);
  const zoom = magnifierZoom(obj.style);
  const group = new Konva.Group({
    id: obj.id,
    x: bounds.x + transform.x,
    y: bounds.y + transform.y,
    width: bounds.width,
    height: bounds.height,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
    draggable: true,
  });

  const clip = new Konva.Group({
    name: "magnifier-clip",
    width: bounds.width,
    height: bounds.height,
    clipFunc(ctx) {
      if (shape === "circle") {
        const radius = Math.min(bounds.width, bounds.height) / 2;
        ctx.arc(bounds.width / 2, bounds.height / 2, radius, 0, Math.PI * 2);
        return;
      }

      const radius = Math.min(cornerRadius(obj.style), bounds.width / 2, bounds.height / 2);
      ctx.roundRect(0, 0, bounds.width, bounds.height, radius);
    },
  });

  if (context?.sourceImage) {
    addMagnifiedImage(clip, bounds, context, zoom);
  }

  group.add(clip);

  if (shape === "circle") {
    group.add(new Konva.Circle({
      name: "magnifier-border",
      x: bounds.width / 2,
      y: bounds.height / 2,
      radius: Math.min(bounds.width, bounds.height) / 2,
      fill: "rgba(255,255,255,0.08)",
      stroke: borderColor(obj.style),
      strokeWidth: borderWidth(obj.style),
    }));
  } else {
    group.add(new Konva.Rect({
      name: "magnifier-border",
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
      fill: "rgba(255,255,255,0.08)",
      stroke: borderColor(obj.style),
      strokeWidth: borderWidth(obj.style),
      cornerRadius: cornerRadius(obj.style),
    }));
  }

  return group;
}
