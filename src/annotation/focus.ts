import Konva from "konva";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";

export type StageSize = { width: number; height: number };

type FocusKind = "rect" | "ellipse";

type FocusAttrs = {
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

function normalizedOpacity(style: AnnotationStyle): number {
  const opacity = style.focusOpacity ?? 0.45;
  if (!Number.isFinite(opacity)) return 0.45;
  return Math.max(0, Math.min(1, opacity));
}

export function shouldRenderFocus(style: AnnotationStyle): boolean {
  return style.focusMode === "spotlight" && normalizedOpacity(style) > 0;
}

function focusColor(style: AnnotationStyle): string {
  return style.focusColor || "#000000";
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

function drawFocusHole(ctx: CanvasRenderingContext2D, attrs: FocusAttrs) {
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
  const attrs = shape.getAttr("focusAttrs") as FocusAttrs | undefined;
  if (!attrs || stageWidth <= 0 || stageHeight <= 0) return;

  const ctx = context._context;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, stageWidth, stageHeight);
  drawFocusHole(ctx, attrs);
  ctx.globalAlpha = shape.getAttr("focusOpacity") as number;
  ctx.fillStyle = shape.getAttr("focusColor") as string;
  ctx.fill("evenodd");
  ctx.restore();
}

function createFocusMask(stageSize: StageSize, style: AnnotationStyle, attrs: FocusAttrs): Konva.Shape {
  return new Konva.Shape({
    name: "focus-mask",
    x: 0,
    y: 0,
    width: stageSize.width,
    height: stageSize.height,
    listening: false,
    perfectDrawEnabled: false,
    focusStageWidth: stageSize.width,
    focusStageHeight: stageSize.height,
    focusAttrs: attrs,
    focusColor: focusColor(style),
    focusOpacity: normalizedOpacity(style),
    sceneFunc: drawFocusScene,
  });
}

function createFocusGroup(obj: AnnotationObject, stageSize: StageSize, boundary: Konva.Shape, attrs: FocusAttrs): Konva.Group {
  const group = new Konva.Group({ id: obj.id, draggable: true });
  const mask = createFocusMask(stageSize, obj.style, attrs);

  boundary.id("");
  boundary.name(`${boundary.name()} focus-boundary`.trim());
  boundary.draggable(false);

  group.add(mask);
  group.add(boundary);

  return group;
}

export function createRectFocusMask(
  obj: AnnotationObject,
  stageSize: StageSize,
  boundary: Konva.Rect,
): Konva.Group {
  return createFocusGroup(obj, stageSize, boundary, {
    kind: "rect",
    x: boundary.x(),
    y: boundary.y(),
    width: boundary.width(),
    height: boundary.height(),
    scaleX: boundary.scaleX(),
    scaleY: boundary.scaleY(),
    rotation: boundary.rotation(),
    cornerRadius: obj.style.cornerRadius ?? 0,
  });
}

export function createEllipseFocusMask(
  obj: AnnotationObject,
  stageSize: StageSize,
  boundary: Konva.Ellipse,
): Konva.Group {
  return createFocusGroup(obj, stageSize, boundary, {
    kind: "ellipse",
    x: boundary.x(),
    y: boundary.y(),
    width: boundary.radiusX() * 2,
    height: boundary.radiusY() * 2,
    scaleX: boundary.scaleX(),
    scaleY: boundary.scaleY(),
    rotation: boundary.rotation(),
  });
}
