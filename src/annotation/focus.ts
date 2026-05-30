import Konva from "konva";
import type { AnnotationObject, AnnotationStyle, SpotlightShape } from "@/annotation/types";

export type StageSize = { width: number; height: number };

export const FOCUS_MASK_NAME = "focus-mask";
const FOCUS_DIM_COLOR = "#000000";
const FOCUS_DIM_OPACITY = 0.5;

type FocusKind = "rect" | "ellipse";

export type FocusHole = {
  kind: FocusKind;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  cornerRadius?: number;
};

export function isSpotlightStyle(style: AnnotationStyle): boolean {
  return style.fill === "spotlight" || style.focusMode === "spotlight";
}

export function shouldRenderFocus(style: AnnotationStyle): boolean {
  return isSpotlightStyle(style);
}

export function rectFocusHole(
  x: number,
  y: number,
  width: number,
  height: number,
  style: AnnotationStyle,
  transform: AnnotationObject["transform"] = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
): FocusHole {
  return {
    kind: "rect",
    x: x + transform.x,
    y: y + transform.y,
    width,
    height,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
    cornerRadius: style.cornerRadius ?? 0,
  };
}

export function ellipseFocusHole(
  x: number,
  y: number,
  width: number,
  height: number,
  transform: AnnotationObject["transform"] = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
): FocusHole {
  return {
    kind: "ellipse",
    x: x + width / 2 + transform.x,
    y: y + height / 2 + transform.y,
    width,
    height,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
  };
}

function annotationSpotlightShape(style: AnnotationStyle): SpotlightShape {
  return style.spotlightShape === "circle" ? "circle" : "rect";
}

export function focusHoleFromObject(obj: AnnotationObject): FocusHole | null {
  if (!isSpotlightStyle(obj.style)) return null;
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? start;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  if (obj.type === "rect") {
    return rectFocusHole(x, y, width, height, obj.style, obj.transform);
  }

  if (obj.type === "ellipse") {
    return ellipseFocusHole(x, y, width, height, obj.transform);
  }

  if (obj.type === "spotlight") {
    const shape = annotationSpotlightShape(obj.style);
    if (shape === "circle") {
      return ellipseFocusHole(x, y, width, height, obj.transform);
    }

    return rectFocusHole(x, y, width, height, obj.style, obj.transform);
  }

  return null;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  if (r > 0) ctx.quadraticCurveTo(width, 0, width, r);
  else ctx.lineTo(width, 0);
  ctx.lineTo(width, height - r);
  if (r > 0) ctx.quadraticCurveTo(width, height, width - r, height);
  else ctx.lineTo(width, height);
  ctx.lineTo(r, height);
  if (r > 0) ctx.quadraticCurveTo(0, height, 0, height - r);
  else ctx.lineTo(0, height);
  ctx.lineTo(0, r);
  if (r > 0) ctx.quadraticCurveTo(0, 0, r, 0);
  else ctx.lineTo(0, 0);
  ctx.closePath();
}

function drawFocusHole(ctx: CanvasRenderingContext2D, attrs: FocusHole) {
  ctx.save();
  ctx.translate(attrs.x, attrs.y);
  ctx.rotate((attrs.rotation * Math.PI) / 180);
  ctx.scale(attrs.scaleX, attrs.scaleY);

  if (attrs.kind === "ellipse") {
    ctx.ellipse(0, 0, attrs.width / 2, attrs.height / 2, 0, 0, Math.PI * 2);
  } else {
    roundedRectPath(ctx, attrs.width, attrs.height, attrs.cornerRadius ?? 0);
  }

  ctx.restore();
}

function drawFocusScene(context: Konva.Context, shape: Konva.Shape) {
  const stageWidth = shape.getAttr("focusStageWidth") as number;
  const stageHeight = shape.getAttr("focusStageHeight") as number;
  const holes = shape.getAttr("focusHoles") as FocusHole[] | undefined;
  if (!holes?.length || stageWidth <= 0 || stageHeight <= 0) return;

  const ctx = context._context;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, stageWidth, stageHeight);
  holes.forEach((hole) => drawFocusHole(ctx, hole));
  ctx.globalAlpha = FOCUS_DIM_OPACITY;
  ctx.fillStyle = FOCUS_DIM_COLOR;
  ctx.fill("evenodd");
  ctx.restore();
}

export function updateFocusMask(mask: Konva.Shape, stageSize: StageSize, holes: FocusHole[]) {
  mask.setAttrs({
    width: stageSize.width,
    height: stageSize.height,
    focusStageWidth: stageSize.width,
    focusStageHeight: stageSize.height,
    focusHoles: holes,
  });
}

export function createFocusMask(stageSize: StageSize, holes: FocusHole[]): Konva.Shape {
  return new Konva.Shape({
    name: FOCUS_MASK_NAME,
    x: 0,
    y: 0,
    width: stageSize.width,
    height: stageSize.height,
    listening: false,
    perfectDrawEnabled: false,
    focusStageWidth: stageSize.width,
    focusStageHeight: stageSize.height,
    focusHoles: holes,
    sceneFunc: drawFocusScene,
  });
}
