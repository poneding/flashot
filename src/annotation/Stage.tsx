import {
  FOCUS_MASK_NAME,
  createFocusMask,
  ellipseFocusHole,
  focusHoleFromObject,
  isSpotlightStyle,
  rectFocusHole,
  updateFocusMask,
  type FocusHole,
} from "@/annotation/focus";
import {
  createMagnifierRenderContext,
  type MagnifierRenderContext,
} from "@/annotation/magnifierContext";
import { loadReleasableFrameImage } from "@/lib/frame-source";
import { MarkerTextOverlay } from "@/annotation/MarkerTextOverlay";
import { MARKER_DEFAULT_FONT_SIZE, markerLabelAnchor } from "@/annotation/markerStyle";
import { renderObject } from "@/annotation/render";
import { useAnnotation } from "@/annotation/store";
import { TextOverlay } from "@/annotation/TextOverlay";
import { onArrowEnd, onArrowMove, onArrowStart } from "@/annotation/tools/arrow";
import { blurResizeUpdatesFromNode, onBlurEnd, onBlurMove, onBlurStart, refreshBlurObjectNode } from "@/annotation/tools/blur";
import { onDrawEnd, onDrawMove, onDrawStart } from "@/annotation/tools/draw";
import { onEllipseEnd, onEllipseMove, onEllipseStart } from "@/annotation/tools/ellipse";
import { onEraserEnd, onEraserMove, onEraserStart } from "@/annotation/tools/eraser";
import {
  highlightBasePosition,
  isStraightHighlightObject,
  onHighlightEnd,
  onHighlightMove,
  onHighlightStart,
  updateHighlightObjectNode,
} from "@/annotation/tools/highlight";
import {
  lineControlPoint,
  onLineEnd,
  onLineMove,
  onLineStart,
  updateLineObjectNode,
} from "@/annotation/tools/line";
import {
  magnifierBasePosition,
  magnifierResizeUpdatesFromNode,
  onMagnifierEnd,
  onMagnifierMove,
  onMagnifierStart,
  refreshMagnifierObjectNode,
} from "@/annotation/tools/magnifier";
import {
  markerPartDragUpdates,
  markerPartFromTarget,
  onMarkerEnd,
  onMarkerMove,
  onMarkerStart,
  updateMarkerObjectNode,
} from "@/annotation/tools/marker";
import {
  constrainMeasureHandlePoint,
  onMeasureEnd,
  onMeasureMove,
  onMeasureStart,
  updateMeasureObjectNode,
} from "@/annotation/tools/measure";
import { onRectEnd, onRectMove, onRectStart } from "@/annotation/tools/rect";
import {
  onSpotlightEnd,
  onSpotlightMove,
  onSpotlightStart,
  spotlightBounds,
  spotlightShape,
} from "@/annotation/tools/spotlight";
import { addTextToLayer } from "@/annotation/tools/text";
import type { AnnotationObject, AnnotationStyle, ToolType } from "@/annotation/types";
import { SELECTION_COLOR } from "@/lib/colors";
import { hitTestHandle } from "@/lib/geometry";
import type { Point, Rect } from "@/lib/types";
import { useOverlay } from "@/overlay/state";
import Konva from "konva";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  selection: Rect;
  scaleFactor: number;
  frameUrl?: string | null;
  frameSourceRect?: Rect | null;
  interacting?: boolean;
};

let stage: Konva.Stage | null = null;
let layer: Konva.Layer | null = null;
let transformer: Konva.Transformer | null = null;
let lineEditGroup: Konva.Group | null = null;
let markerSelectionGroup: Konva.Group | null = null;
let magnifierSourceImage: HTMLImageElement | null = null;
let magnifierScaleFactor = 1;
let magnifierSourceRect: Rect | null = null;
// Wheel resize accumulates raw deltaY across events so one trackpad gesture
// (which fires many small-delta events) advances at a controlled pace instead
// of racing. One size step is taken each time the accumulator crosses the
// threshold; the sign resets the accumulator so direction changes feel instant.
let wheelResizeAccum = 0;
export const WHEEL_RESIZE_THRESHOLD = 80;

/// Fold a raw wheel deltaY into the accumulator and decide whether a discrete
/// size step is due. A trackpad fires dozens of small-delta events per gesture,
/// so we only advance one step per threshold crossing instead of once per event.
/// A direction flip resets the accumulator so reversing feels immediate.
export function wheelResizeStep(
  accum: number,
  deltaY: number,
  threshold = WHEEL_RESIZE_THRESHOLD,
): { step: -1 | 0 | 1; nextAccum: number } {
  let next = accum;
  if ((next > 0 && deltaY < 0) || (next < 0 && deltaY > 0)) next = 0;
  next += deltaY;
  if (Math.abs(next) < threshold) return { step: 0, nextAccum: next };
  // Wheel-down (deltaY > 0) shrinks; wheel-up grows.
  return { step: next > 0 ? -1 : 1, nextAccum: 0 };
}

export type AnnotationResizeUpdate =
  | { kind: "style"; updates: Partial<AnnotationStyle> }
  | { kind: "bounds"; updates: Partial<AnnotationObject> }
  | null;

/// Map one discrete size step onto a concrete update for the given object.
/// Stroke-based shapes change `strokeWidth`, blur changes intensity, text/marker
/// change `fontSize`, and magnifier/spotlight rescale their bounds around the
/// center. Returns null when the step would not change anything (already clamped).
export function annotationResizeUpdates(
  obj: AnnotationObject,
  step: -1 | 1,
): AnnotationResizeUpdate {
  switch (obj.type) {
    case "line":
    case "arrow":
    case "highlight":
    case "draw":
    case "measure":
    case "rect":
    case "ellipse": {
      const current = obj.style.strokeWidth ?? 4;
      const next = Math.max(1, Math.min(30, current + step));
      return next !== current ? { kind: "style", updates: { strokeWidth: next } } : null;
    }
    case "blur": {
      const current = obj.style.blurIntensity ?? 10;
      const next = Math.max(3, Math.min(30, current + step));
      return next !== current ? { kind: "style", updates: { blurIntensity: next } } : null;
    }
    case "marker": {
      const current = obj.style.fontSize ?? MARKER_DEFAULT_FONT_SIZE;
      const next = Math.max(12, Math.min(48, current + step * 2));
      return next !== current ? { kind: "style", updates: { fontSize: next } } : null;
    }
    case "text": {
      const current = obj.style.fontSize ?? 16;
      const next = Math.max(12, Math.min(96, current + step * 4));
      return next !== current ? { kind: "style", updates: { fontSize: next } } : null;
    }
    case "magnifier":
    case "spotlight": {
      const start = obj.start ?? { x: 0, y: 0 };
      const end = obj.end ?? start;
      const currentWidth = Math.abs(end.x - start.x);
      const currentHeight = Math.abs(end.y - start.y);
      const currentSize = Math.max(currentWidth, currentHeight);
      if (currentSize === 0) return null;
      const nextSize = Math.max(50, Math.min(500, currentSize + step * 10));
      if (nextSize === currentSize) return null;
      const scale = nextSize / currentSize;
      const centerX = (start.x + end.x) / 2;
      const centerY = (start.y + end.y) / 2;
      const halfWidth = (currentWidth * scale) / 2;
      const halfHeight = (currentHeight * scale) / 2;
      return {
        kind: "bounds",
        updates: {
          start: { x: centerX - halfWidth, y: centerY - halfHeight },
          end: { x: centerX + halfWidth, y: centerY + halfHeight },
        },
      };
    }
    default:
      return null;
  }
}

let focusPreview: {
  shape: "rect" | "ellipse" | "circle";
  start: Point;
  end: Point;
  style: AnnotationStyle;
} | null = null;

type LineEditHandle = "start" | "control" | "end";

const TRANSFORMER_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
];
const EDIT_OVERLAY_NAME = "annotation-edit-overlay";
const MARKER_SELECTION_RING_OFFSET = 4;
const ROTATE_ANCHOR_SIZE = 20;
const ROTATE_ICON_SIZE = 15;
const RIGHT_ANGLE_SNAP_THRESHOLD = 5;
export const ANNOTATION_ROTATE_ANCHOR_OFFSET = 22;
const REFRESH_CCW_DOT_PATHS = [
  "M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
  "M3 3v5h5",
  "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16",
  "M16 16h5v5",
];

export function getStage(): Konva.Stage | null {
  return stage;
}

export function getLayer(): Konva.Layer | null {
  return layer;
}

export function getTransformer(): Konva.Transformer | null {
  return transformer;
}

export function annotationAccentColor(): string {
  if (typeof document === "undefined") return SELECTION_COLOR;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--flashot-accent")
    .trim();
  return value || SELECTION_COLOR;
}

export function transformerAccentConfig(): { borderStroke: string; anchorStroke: string } {
  const stroke = annotationAccentColor();
  return { borderStroke: stroke, anchorStroke: stroke };
}

function drawFallbackRotateIcon(ctx: CanvasRenderingContext2D, color: string) {
  ctx.save();
  ctx.translate(10, 10);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, Math.PI * 0.15, Math.PI * 1.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-5.3, -5);
  ctx.lineTo(-5.3, -8);
  ctx.lineTo(-8.3, -8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRotateAnchorScene(context: Konva.Context, shape: Konva.Shape) {
  const ctx = context._context;
  const size = shape.width();
  const accent = annotationAccentColor();

  ctx.save();

  if (typeof Path2D === "undefined") {
    drawFallbackRotateIcon(ctx, accent);
    ctx.restore();
    return;
  }

  const iconOffset = (size - ROTATE_ICON_SIZE) / 2;
  ctx.translate(iconOffset, iconOffset);
  ctx.scale(ROTATE_ICON_SIZE / 24, ROTATE_ICON_SIZE / 24);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of REFRESH_CCW_DOT_PATHS) {
    ctx.stroke(new Path2D(d));
  }
  ctx.beginPath();
  ctx.arc(12, 12, 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRotateAnchorHit(context: Konva.Context, shape: Konva.Shape) {
  const size = shape.width();
  const ctx = context._context;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 + 5, 0, Math.PI * 2);
  ctx.closePath();
  context.fillStrokeShape(shape);
}

type ToolHandlers = {
  start: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (x: number, y: number) => AnnotationObject | null;
};

const TOOL_HANDLERS: Partial<Record<ToolType, ToolHandlers>> = {
  draw: { start: onDrawStart, move: onDrawMove, end: (_x, _y) => onDrawEnd() },
  line: { start: onLineStart, move: onLineMove, end: onLineEnd },
  measure: { start: onMeasureStart, move: onMeasureMove, end: onMeasureEnd },
  arrow: { start: onArrowStart, move: onArrowMove, end: onArrowEnd },
  rect: { start: onRectStart, move: onRectMove, end: onRectEnd },
  ellipse: { start: onEllipseStart, move: onEllipseMove, end: onEllipseEnd },
  spotlight: { start: onSpotlightStart, move: onSpotlightMove, end: onSpotlightEnd },
  highlight: { start: onHighlightStart, move: onHighlightMove, end: onHighlightEnd },
  blur: { start: onBlurStart, move: onBlurMove, end: onBlurEnd },
  marker: { start: onMarkerStart, move: onMarkerMove, end: () => onMarkerEnd() },
  magnifier: { start: onMagnifierStart, move: onMagnifierMove, end: onMagnifierEnd },
};

function objectBasePosition(obj: AnnotationObject): { x: number; y: number } {
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? start;

  if (obj.type === "rect" || obj.type === "blur") {
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
  }

  if (obj.type === "ellipse") {
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }

  if (obj.type === "spotlight") {
    if (spotlightShape(obj.style) === "circle") {
      return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    }
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
  }

  if (obj.type === "text") {
    return start;
  }

  if (obj.type === "marker") {
    // Marker outer groups carry only the transform offset; the badge and label
    // parts hold absolute stage positions (see renderMarkerObject).
    return { x: 0, y: 0 };
  }

  if (obj.type === "line" || obj.type === "arrow" || obj.type === "measure") {
    return start;
  }

  if (obj.type === "highlight") {
    return highlightBasePosition(obj);
  }

  if (obj.type === "magnifier") {
    return magnifierBasePosition(obj);
  }

  return { x: 0, y: 0 };
}

function getNodeTransform(obj: AnnotationObject, node: Konva.Node): AnnotationObject["transform"] {
  const base = objectBasePosition(obj);
  return {
    x: node.x() - base.x,
    y: node.y() - base.y,
    scaleX: node.scaleX(),
    scaleY: node.scaleY(),
    rotation: node.rotation(),
  };
}

export function isNodeInTree(node: Konva.Node | null, root: Konva.Node | null): boolean {
  let current: Konva.Node | null = node;
  while (current) {
    if (current === root) return true;
    current = current.getParent();
  }
  return false;
}

function isTransformerNode(node: Konva.Node | null): boolean {
  return isNodeInTree(node, transformer);
}

function isEndpointEditableObject(obj: AnnotationObject | undefined): boolean {
  return obj?.type === "line" || obj?.type === "arrow" || obj?.type === "measure" || isStraightHighlightObject(obj);
}

function editableLineHandles(obj: AnnotationObject): LineEditHandle[] {
  if (isStraightHighlightObject(obj)) return ["start", "end"];
  return obj.type === "measure" ? ["start", "end"] : ["start", "control", "end"];
}

function isEditOverlayNode(node: Konva.Node | null): boolean {
  let current: Konva.Node | null = node;
  while (current) {
    if (current.hasName(EDIT_OVERLAY_NAME)) return true;
    current = current.getParent();
  }
  return false;
}

export function cursorForAnnotationInteraction(type: "drag" | "point" | "rotate" | "resize"): string {
  if (type === "drag") return "move";
  if (type === "resize") return "nwse-resize";
  return "grab";
}

export function shouldDeselectOnEmptyClick(selectedObjectId: string | null, tool: ToolType): boolean {
  return Boolean(selectedObjectId && tool !== "text" && tool !== "eraser");
}

export function styleTransformerAnchor(anchor: Konva.Rect): string | null {
  if (!anchor.hasName("rotater")) return null;
  anchor.setAttrs({
    width: ROTATE_ANCHOR_SIZE,
    height: ROTATE_ANCHOR_SIZE,
    offsetX: ROTATE_ANCHOR_SIZE / 2,
    offsetY: ROTATE_ANCHOR_SIZE / 2,
    fill: "rgba(0,0,0,0)",
    stroke: "rgba(0,0,0,0)",
    strokeWidth: 0,
    hitStrokeWidth: 14,
  });
  anchor.cornerRadius(0);
  anchor.sceneFunc(drawRotateAnchorScene);
  anchor.hitFunc(drawRotateAnchorHit);
  return cursorForAnnotationInteraction("rotate");
}

export function snapRotationToRightAngle(degrees: number, threshold = RIGHT_ANGLE_SNAP_THRESHOLD): number {
  if (!Number.isFinite(degrees)) return degrees;
  const normalized = ((degrees % 360) + 360) % 360;
  let target = Math.round(normalized / 90) * 90;
  if (target === 360) target = 0;
  const distance = Math.min(Math.abs(normalized - target), 360 - Math.abs(normalized - target));
  return distance <= threshold ? target : degrees;
}

function nodeClientCenter(node: Konva.Node): Point {
  const rect = node.getClientRect({ skipShadow: true });
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function snapNodeRotationToRightAngle(node: Konva.Node): boolean {
  const snapped = snapRotationToRightAngle(node.rotation());
  if (snapped === node.rotation()) return false;

  const before = nodeClientCenter(node);
  node.rotation(snapped);
  const after = nodeClientCenter(node);
  node.position({
    x: node.x() + before.x - after.x,
    y: node.y() + before.y - after.y,
  });
  return true;
}

function snapNodeRotationIfEnabled(obj: AnnotationObject, node: Konva.Node) {
  if (!transformerConfigForObject(obj).rotateEnabled) return;
  snapNodeRotationToRightAngle(node);
}

export function transformerConfigForObject(obj: AnnotationObject | undefined): {
  useTransformer: boolean;
  rotateEnabled: boolean;
  enabledAnchors: string[];
} {
  if (!obj) return { useTransformer: false, rotateEnabled: false, enabledAnchors: [] };
  if (isEndpointEditableObject(obj)) return { useTransformer: false, rotateEnabled: false, enabledAnchors: [] };
  if (obj.type === "draw") return { useTransformer: true, rotateEnabled: false, enabledAnchors: [] };
  if (obj.type === "marker") return { useTransformer: false, rotateEnabled: false, enabledAnchors: [] };
  if (obj.type === "highlight") return { useTransformer: true, rotateEnabled: false, enabledAnchors: [] };
  if (obj.type === "text" || obj.type === "blur" || obj.type === "magnifier" || obj.type === "spotlight") {
    return { useTransformer: true, rotateEnabled: false, enabledAnchors: TRANSFORMER_ANCHORS };
  }
  return { useTransformer: true, rotateEnabled: true, enabledAnchors: TRANSFORMER_ANCHORS };
}

function getObjectNodeFromHit(node: Konva.Node | null): Konva.Node | null {
  let current: Konva.Node | null = node;
  while (current) {
    if (isTransformerNode(current)) return null;
    if (current.id()) return current;
    if (current === layer || current === stage) return null;
    current = current.getParent();
  }
  return null;
}

function findRenderedObjectNode(id: string): Konva.Node | null {
  if (!layer || !transformer) return null;
  return layer.getChildren((node) => node !== transformer).find((node) => node.id() === id) ?? null;
}

export function shouldReplaceRenderedObject(
  prev: AnnotationObject | undefined,
  next: AnnotationObject,
): boolean {
  if (!prev) return false;
  return (
    prev.type !== next.type ||
    prev.style !== next.style ||
    prev.start !== next.start ||
    prev.end !== next.end ||
    prev.points !== next.points ||
    prev.text !== next.text
  );
}

function applyObjectTransformToNode(obj: AnnotationObject, node: Konva.Node) {
  const base = objectBasePosition(obj);
  node.x(base.x + obj.transform.x);
  node.y(base.y + obj.transform.y);
  node.scaleX(obj.transform.scaleX);
  node.scaleY(obj.transform.scaleY);
  node.rotation(obj.transform.rotation);
}

function currentStageSize(): { width: number; height: number } | undefined {
  if (!stage) return undefined;
  return { width: stage.width(), height: stage.height() };
}

function focusPreviewHole(): FocusHole | null {
  if (!focusPreview) return null;
  const bounds = focusPreview.shape === "circle"
    ? spotlightBounds(focusPreview.start, focusPreview.end, "circle")
    : {
      x: Math.min(focusPreview.start.x, focusPreview.end.x),
      y: Math.min(focusPreview.start.y, focusPreview.end.y),
      width: Math.abs(focusPreview.end.x - focusPreview.start.x),
      height: Math.abs(focusPreview.end.y - focusPreview.start.y),
    };

  if (focusPreview.shape === "rect") {
    return rectFocusHole(bounds.x, bounds.y, bounds.width, bounds.height, focusPreview.style);
  }

  return ellipseFocusHole(bounds.x, bounds.y, bounds.width, bounds.height);
}

function currentFocusHoles(previewObject?: AnnotationObject): FocusHole[] {
  const objectHoles = useAnnotation.getState().objects
    .map((obj) => (previewObject?.id === obj.id ? previewObject : obj))
    .map((obj) => focusHoleFromObject(obj))
    .filter((hole): hole is FocusHole => Boolean(hole));
  const previewHole = focusPreviewHole();
  return previewHole ? [...objectHoles, previewHole] : objectHoles;
}

function syncFocusMask(previewObject?: AnnotationObject) {
  if (!layer) return;
  const stageSize = currentStageSize();
  const existingMask = layer.findOne(`.${FOCUS_MASK_NAME}`) as Konva.Shape | undefined;
  if (!stageSize) {
    existingMask?.destroy();
    layer.batchDraw();
    return;
  }

  const holes = currentFocusHoles(previewObject);
  if (holes.length === 0) {
    existingMask?.destroy();
    layer.batchDraw();
    return;
  }

  const mask = existingMask ?? createFocusMask(stageSize, holes);
  if (!existingMask) layer.add(mask);
  else updateFocusMask(mask, stageSize, holes);
  mask.moveToBottom();
  layer.batchDraw();
}

function beginFocusPreview(tool: ToolType, point: Point, style: AnnotationStyle) {
  const shape = (() => {
    if (tool === "spotlight") return spotlightShape(style) === "circle" ? "circle" : "rect";
    if (tool === "rect" && isSpotlightStyle(style)) return "rect";
    if (tool === "ellipse" && isSpotlightStyle(style)) return "ellipse";
    return null;
  })();

  if (!shape) {
    focusPreview = null;
    return;
  }

  focusPreview = {
    shape,
    start: point,
    end: point,
    style: { ...style },
  };
  syncFocusMask();
}

function updateFocusPreview(point: Point) {
  if (!focusPreview) return;
  focusPreview = { ...focusPreview, end: point };
  syncFocusMask();
}

function clearFocusPreview(sync = true) {
  if (!focusPreview) return;
  focusPreview = null;
  if (sync) syncFocusMask();
}


export function getMagnifierRenderContext(excludeObjectId?: string): MagnifierRenderContext | null {
  if (!magnifierSourceImage) return null;
  const stageSize = currentStageSize();
  if (!stageSize) return null;

  return createMagnifierRenderContext({
    sourceImage: magnifierSourceImage,
    stageSize,
    scaleFactor: magnifierScaleFactor,
    sourceRect: magnifierSourceRect,
    objects: useAnnotation.getState().objects,
    excludeObjectId,
  });
}

function usesRenderContext(obj: AnnotationObject): boolean {
  return obj.type === "magnifier" || obj.type === "blur";
}

function currentRenderContext(excludeObjectId?: string) {
  return {
    stageSize: currentStageSize(),
    magnifier: getMagnifierRenderContext(excludeObjectId),
  };
}

function objectWithNodeTransform(obj: AnnotationObject, node: Konva.Node): AnnotationObject {
  return {
    ...obj,
    transform: getNodeTransform(obj, node),
  };
}

function previewObjectForNodeTransform(obj: AnnotationObject, node: Konva.Node): AnnotationObject {
  return { ...obj, ...resizeUpdatesForTransformedObject(obj, node) };
}

function rectResizeBoundsFromNode(node: Konva.Node): { x: number; y: number; width: number; height: number } {
  const shape = node as Konva.Shape;
  const width = Math.max(1, shape.width() * Math.abs(node.scaleX()));
  const height = Math.max(1, shape.height() * Math.abs(node.scaleY()));
  return {
    x: node.scaleX() < 0 ? node.x() - width : node.x(),
    y: node.scaleY() < 0 ? node.y() - height : node.y(),
    width,
    height,
  };
}

function ellipseResizeBoundsFromNode(node: Konva.Node): { x: number; y: number; width: number; height: number } {
  const ellipse = node as Konva.Ellipse;
  const width = Math.max(1, ellipse.radiusX() * 2 * Math.abs(node.scaleX()));
  const height = Math.max(1, ellipse.radiusY() * 2 * Math.abs(node.scaleY()));
  return {
    x: node.x() - width / 2,
    y: node.y() - height / 2,
    width,
    height,
  };
}

function bakeRectNodeResize(node: Konva.Node) {
  const bounds = rectResizeBoundsFromNode(node);
  node.setAttrs({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    scaleX: 1,
    scaleY: 1,
  });
}

function bakeEllipseNodeResize(node: Konva.Node) {
  const ellipse = node as Konva.Ellipse;
  const bounds = ellipseResizeBoundsFromNode(node);
  ellipse.setAttrs({
    radiusX: bounds.width / 2,
    radiusY: bounds.height / 2,
    scaleX: 1,
    scaleY: 1,
  });
}

function bakeLiveResizeIntoNode(obj: AnnotationObject, node: Konva.Node): boolean {
  if (obj.type === "rect") {
    bakeRectNodeResize(node);
    return true;
  }

  if (obj.type === "ellipse") {
    bakeEllipseNodeResize(node);
    return true;
  }

  if (obj.type === "spotlight") {
    if (spotlightShape(obj.style) === "circle") bakeEllipseNodeResize(node);
    else bakeRectNodeResize(node);
    return true;
  }

  return false;
}

function bakedRectResizeUpdatesFromNode(_obj: AnnotationObject, node: Konva.Node): Partial<AnnotationObject> {
  const bounds = rectResizeBoundsFromNode(node);

  return {
    start: { x: bounds.x, y: bounds.y },
    end: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: node.rotation() },
  };
}

function bakedEllipseResizeUpdatesFromNode(_obj: AnnotationObject, node: Konva.Node): Partial<AnnotationObject> {
  const bounds = ellipseResizeBoundsFromNode(node);

  return {
    start: { x: bounds.x, y: bounds.y },
    end: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: node.rotation() },
  };
}

function resizeUpdatesForTransformedObject(obj: AnnotationObject, node: Konva.Node): Partial<AnnotationObject> {
  if (obj.type === "blur") return blurResizeUpdatesFromNode(node);
  if (obj.type === "magnifier") return magnifierResizeUpdatesFromNode(obj, node);
  if (obj.type === "rect") return bakedRectResizeUpdatesFromNode(obj, node);
  if (obj.type === "ellipse") return bakedEllipseResizeUpdatesFromNode(obj, node);
  if (obj.type === "spotlight") {
    return spotlightShape(obj.style) === "circle"
      ? bakedEllipseResizeUpdatesFromNode(obj, node)
      : bakedRectResizeUpdatesFromNode(obj, node);
  }
  return { transform: getNodeTransform(obj, node) };
}

function refreshLivePositionDependentNode(obj: AnnotationObject, node: Konva.Node) {
  if (obj.type === "blur") {
    refreshBlurObjectNode(node, obj);
  } else if (obj.type === "magnifier") {
    refreshMagnifierObjectNode(node, obj);
  }

  if (isSpotlightStyle(obj.style)) {
    syncFocusMask(obj);
  }
}

function viewportOriginForStage(container: HTMLDivElement | null, selection: Rect): Point {
  const rect = container?.getBoundingClientRect();
  if (!rect) return { x: selection.x, y: selection.y };
  return { x: rect.left, y: rect.top };
}

function isTextInputLike(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLInputElement) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

function replaceRenderedObjectNode(obj: AnnotationObject): Konva.Node | null {
  if (!layer) return null;
  const existingNode = findRenderedObjectNode(obj.id);
  const nextNode = renderObject(obj, currentRenderContext(obj.id));
  const zIndex = existingNode?.zIndex();

  existingNode?.destroy();
  if (!nextNode) return null;

  layer.add(nextNode);
  if (zIndex != null) nextNode.zIndex(zIndex);
  return nextNode;
}

function setStageCursor(cursor: string) {
  const container = stage?.container();
  if (container) container.style.cursor = cursorWithColorPickerOverride(cursor);
}

function cursorWithColorPickerOverride(cursor: string): string {
  return useOverlay.getState().colorPickerVisible ? "crosshair" : cursor;
}

function toolCursor(
  tool = useAnnotation.getState().activeTool,
  style = useAnnotation.getState().activeStyle,
): string {
  switch (tool) {
    case "select": return "move";
    case "text": return "text";
    case "eraser": return "grab";
    case "highlight": return style.highlightMode === "straight" ? "text" : "crosshair";
    case "magnifier": return style.magnifierShape === "rounded-rect" ? "crosshair" : "zoom-in";
    default: return "crosshair";
  }
}

export function stageCursorForTool(
  tool: ToolType,
  style: AnnotationStyle,
  colorPickerVisible: boolean,
): string {
  return colorPickerVisible ? "crosshair" : toolCursor(tool, style);
}

function normalizedLayerPixelRatio(scaleFactor: number): number {
  if (!Number.isFinite(scaleFactor)) return 1;
  return Math.max(1, scaleFactor);
}

function applyLayerPixelRatio(nextLayer: Konva.Layer, scaleFactor: number) {
  const pixelRatio = normalizedLayerPixelRatio(scaleFactor);
  const sceneCanvas = nextLayer.getCanvas();
  if (sceneCanvas.getPixelRatio() === pixelRatio) return;
  sceneCanvas.setPixelRatio(pixelRatio);
  nextLayer.batchDraw();
}

function linePointWithTransform(obj: AnnotationObject, point: Point): Point {
  return {
    x: point.x + obj.transform.x,
    y: point.y + obj.transform.y,
  };
}

function lineVisualPointToObjectPoint(obj: AnnotationObject, point: Point): Point {
  return {
    x: point.x - obj.transform.x,
    y: point.y - obj.transform.y,
  };
}

function highlightEndpointPoints(obj: AnnotationObject): { start: Point; end: Point } {
  const points = obj.points ?? [];
  return {
    start: obj.start ?? { x: points[0] ?? 0, y: points[1] ?? 0 },
    end: obj.end ?? {
      x: points[points.length - 2] ?? points[0] ?? 0,
      y: points[points.length - 1] ?? points[1] ?? 0,
    },
  };
}

function straightHighlightHandleObject(
  obj: AnnotationObject,
  handle: LineEditHandle,
  objectPoint: Point,
): AnnotationObject {
  const current = highlightEndpointPoints(obj);
  const start = handle === "start" ? objectPoint : current.start;
  const end = handle === "end" ? objectPoint : current.end;
  return {
    ...obj,
    start,
    end,
    points: [start.x, start.y, end.x, end.y],
  };
}

function lineHandleObject(obj: AnnotationObject, handle: LineEditHandle, point: Point): AnnotationObject {
  const objectPoint = lineVisualPointToObjectPoint(obj, point);
  if (isStraightHighlightObject(obj)) return straightHighlightHandleObject(obj, handle, objectPoint);
  if (obj.type === "measure" && (handle === "start" || handle === "end")) {
    return constrainMeasureHandlePoint(obj, handle, objectPoint);
  }
  if (handle === "start") return { ...obj, start: objectPoint };
  if (handle === "end") return { ...obj, end: objectPoint };
  return { ...obj, points: [objectPoint.x, objectPoint.y] };
}

function lineHandlePoint(obj: AnnotationObject, handle: LineEditHandle): Point {
  if (isStraightHighlightObject(obj)) {
    const endpoints = highlightEndpointPoints(obj);
    return linePointWithTransform(obj, handle === "start" ? endpoints.start : endpoints.end);
  }
  if (handle === "start") return linePointWithTransform(obj, obj.start ?? { x: 0, y: 0 });
  if (handle === "end") return linePointWithTransform(obj, obj.end ?? { x: 0, y: 0 });
  return linePointWithTransform(obj, lineControlPoint(obj));
}

function clearLineEditHandles() {
  lineEditGroup?.destroy();
  lineEditGroup = null;
}

function clearMarkerSelectionChrome() {
  markerSelectionGroup?.destroy();
  markerSelectionGroup = null;
}

// Markers use no transformer; selection feedback is a dashed accent ring
// around the badge plus, when present, a dashed rect around the label box.
// EDIT_OVERLAY_NAME keeps the chrome out of exports (see export.ts).
function renderMarkerSelectionChrome(obj: AnnotationObject) {
  if (!layer) return;
  clearMarkerSelectionChrome();
  const node = findRenderedObjectNode(obj.id);
  if (!(node instanceof Konva.Group)) return;
  const badgePart = node.findOne(".marker-badge-part") as Konva.Group | undefined;
  const badge = badgePart?.findOne(".marker-badge") as Konva.Circle | undefined;
  if (!badgePart || !badge) return;

  const ringStyle = {
    stroke: annotationAccentColor(),
    strokeWidth: 1.5,
    dash: [4, 3],
    listening: false,
  };
  const chrome = new Konva.Group({ name: `${EDIT_OVERLAY_NAME} marker-selection`, listening: false });

  chrome.add(new Konva.Circle({
    ...ringStyle,
    name: "marker-selection-badge-ring",
    x: node.x() + badgePart.x(),
    y: node.y() + badgePart.y(),
    radius: badge.radius() + MARKER_SELECTION_RING_OFFSET,
  }));

  const labelPart = node.findOne(".marker-label-part") as Konva.Group | undefined;
  const box = labelPart?.findOne(".marker-label-box") as Konva.Rect | undefined;
  if (labelPart && box) {
    chrome.add(new Konva.Rect({
      ...ringStyle,
      name: "marker-selection-label-ring",
      x: node.x() + labelPart.x() - MARKER_SELECTION_RING_OFFSET,
      y: node.y() + labelPart.y() - MARKER_SELECTION_RING_OFFSET,
      width: box.width() + MARKER_SELECTION_RING_OFFSET * 2,
      height: box.height() + MARKER_SELECTION_RING_OFFSET * 2,
    }));
  }

  layer.add(chrome);
  chrome.moveToTop();
  markerSelectionGroup = chrome;
}

function moveLineEditHandles(obj: AnnotationObject, activeHandle?: LineEditHandle) {
  if (!lineEditGroup) return;
  const handles = editableLineHandles(obj);
  handles.forEach((handle) => {
    if (handle === activeHandle) return;
    const node = lineEditGroup?.findOne(`.line-edit-${handle}`) as Konva.Circle | undefined;
    const point = lineHandlePoint(obj, handle);
    node?.position(point);
  });
  const guide = lineEditGroup.findOne(".line-edit-guide") as Konva.Line | undefined;
  const start = lineHandlePoint(obj, "start");
  const end = lineHandlePoint(obj, "end");
  if (handles.includes("control")) {
    const control = lineHandlePoint(obj, "control");
    guide?.points([start.x, start.y, control.x, control.y, end.x, end.y]);
  } else {
    guide?.points([start.x, start.y, end.x, end.y]);
  }
}

function previewLineHandleDrag(
  obj: AnnotationObject,
  handle: LineEditHandle,
  point: Point,
): AnnotationObject {
  const nextObj = lineHandleObject(obj, handle, point);
  const node = findRenderedObjectNode(obj.id);
  if (node instanceof Konva.Group) {
    node.position({
      x: nextObj.start!.x + nextObj.transform.x,
      y: nextObj.start!.y + nextObj.transform.y,
    });
    if (nextObj.type === "highlight") updateHighlightObjectNode(node, nextObj);
    else if (nextObj.type === "measure") updateMeasureObjectNode(node, nextObj);
    else updateLineObjectNode(node, nextObj);
  }
  moveLineEditHandles(nextObj, handle);
  return nextObj;
}

function persistLineHandleDrag(
  obj: AnnotationObject,
  handle: LineEditHandle,
  point: Point,
) {
  const nextObj = lineHandleObject(obj, handle, point);
  const { resizeObject } = useAnnotation.getState();
  if (isStraightHighlightObject(obj)) {
    resizeObject(obj.id, { start: nextObj.start, end: nextObj.end, points: nextObj.points });
    return;
  }
  if (obj.type === "measure" && (handle === "start" || handle === "end")) {
    resizeObject(obj.id, { start: nextObj.start, end: nextObj.end });
    return;
  }
  if (handle === "start") resizeObject(obj.id, { start: nextObj.start });
  else if (handle === "end") resizeObject(obj.id, { end: nextObj.end });
  else resizeObject(obj.id, { points: nextObj.points });
}

function createLineEditHandle(obj: AnnotationObject, handle: LineEditHandle): Konva.Circle {
  const point = lineHandlePoint(obj, handle);
  const accent = annotationAccentColor();
  const circle = new Konva.Circle({
    x: point.x,
    y: point.y,
    radius: handle === "control" ? 5 : 6,
    fill: "#ffffff",
    stroke: accent,
    strokeWidth: 2,
    draggable: true,
    name: `${EDIT_OVERLAY_NAME} line-edit-handle line-edit-${handle}`,
  });

  circle.on("mouseenter", () => setStageCursor(cursorForAnnotationInteraction("point")));
  circle.on("mouseleave", () => setStageCursor(toolCursor()));
  circle.on("dragstart", () => setStageCursor("grabbing"));
  circle.on("dragmove", () => {
    const nextObj = previewLineHandleDrag(obj, handle, { x: circle.x(), y: circle.y() });
    circle.position(lineHandlePoint(nextObj, handle));
    layer?.batchDraw();
  });
  circle.on("dragend", () => {
    setStageCursor(cursorForAnnotationInteraction("point"));
    persistLineHandleDrag(obj, handle, { x: circle.x(), y: circle.y() });
  });

  return circle;
}

function renderLineEditHandles(obj: AnnotationObject) {
  if (!layer) return;
  clearLineEditHandles();
  lineEditGroup = new Konva.Group({ name: EDIT_OVERLAY_NAME });
  const accent = annotationAccentColor();

  const handles = editableLineHandles(obj);
  const start = lineHandlePoint(obj, "start");
  const end = lineHandlePoint(obj, "end");
  const guidePoints = handles.includes("control")
    ? (() => {
      const control = lineHandlePoint(obj, "control");
      return [start.x, start.y, control.x, control.y, end.x, end.y];
    })()
    : [start.x, start.y, end.x, end.y];

  lineEditGroup.add(new Konva.Line({
    points: guidePoints,
    stroke: accent,
    strokeWidth: 1,
    dash: [4, 4],
    listening: false,
    name: `${EDIT_OVERLAY_NAME} line-edit-guide`,
  }));

  handles.forEach((handle) => {
    lineEditGroup?.add(createLineEditHandle(obj, handle));
  });

  layer.add(lineEditGroup);
  lineEditGroup.moveToTop();
}

function syncSelectionWithStore(selectedObjectId = useAnnotation.getState().selectedObjectId) {
  if (!layer || !transformer) return;
  const accentConfig = transformerAccentConfig();
  transformer.borderStroke(accentConfig.borderStroke);
  transformer.anchorStroke(accentConfig.anchorStroke);
  clearLineEditHandles();
  clearMarkerSelectionChrome();
  if (!selectedObjectId) {
    transformer.nodes([]);
    layer.batchDraw();
    return;
  }

  const selectedObject = useAnnotation.getState().objects.find((obj) => obj.id === selectedObjectId);
  const config = transformerConfigForObject(selectedObject);
  if (!config.useTransformer) {
    transformer.nodes([]);
    if (selectedObject && isEndpointEditableObject(selectedObject)) {
      renderLineEditHandles(selectedObject);
    } else if (selectedObject?.type === "marker") {
      renderMarkerSelectionChrome(selectedObject);
    }
    layer.batchDraw();
    return;
  }

  transformer.rotateEnabled(config.rotateEnabled);
  transformer.enabledAnchors(config.enabledAnchors);
  const selectedNode = findRenderedObjectNode(selectedObjectId);
  transformer.nodes(selectedNode ? [selectedNode] : []);
  transformer.moveToTop();
  layer.batchDraw();
}

function syncLayerWithStore(prevObjects: AnnotationObject[] = []) {
  if (!layer || !transformer) return;
  const { objects, selectedObjectId } = useAnnotation.getState();
  const prevById = new Map(prevObjects.map((obj) => [obj.id, obj]));
  const objectIds = new Set(objects.map((obj) => obj.id));

  transformer.nodes([]);
  layer
    .getChildren((node) => node !== transformer)
    .forEach((node) => {
      if (node.id() && !objectIds.has(node.id())) node.destroy();
    });

  for (const obj of objects) {
    const existingNode = findRenderedObjectNode(obj.id);
    const prevObj = prevById.get(obj.id);

    if (!existingNode) {
      const node = renderObject(obj, currentRenderContext(obj.id));
      if (node) layer.add(node);
      continue;
    }

    if (shouldReplaceRenderedObject(prevObj, obj)) {
      replaceRenderedObjectNode(obj);
      continue;
    }

    if (prevObj?.transform !== obj.transform) {
      applyObjectTransformToNode(obj, existingNode);
      refreshLivePositionDependentNode(obj, existingNode);
    }
  }

  objects.forEach((obj, index) => {
    findRenderedObjectNode(obj.id)?.zIndex(index);
  });

  syncFocusMask();
  syncSelectionWithStore(selectedObjectId);
}

export function AnnotationStage({ selection, scaleFactor, frameUrl, frameSourceRect, interacting }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTool = useAnnotation((s) => s.activeTool);
  const activeStyle = useAnnotation((s) => s.activeStyle);
  const hasMagnifierObjects = useAnnotation((s) => s.objects.some((object) => object.type === "magnifier"));
  const colorPickerVisible = useOverlay((s) => s.colorPickerVisible);
  const [, forceRender] = useState(0);
  const [textEditing, setTextEditing] = useState<{ position: { x: number; y: number }; editingObject: AnnotationObject | null; key: number } | null>(null);
  const [markerEditing, setMarkerEditing] = useState<{ object: AnnotationObject; key: number } | null>(null);
  const textFlushRef = useRef<(() => void) | null>(null);
  const textKeyRef = useRef(0);
  const markerKeyRef = useRef(0);
  const viewportOrigin = viewportOriginForStage(containerRef.current, selection);
  const needsMagnifierSource = activeTool === "magnifier" || hasMagnifierObjects;

  const openMarkerEditor = (object: AnnotationObject) => {
    useAnnotation.getState().setSelectedObject(null);
    markerKeyRef.current++;
    setMarkerEditing({ object, key: markerKeyRef.current });
  };

  const onWheel = useCallback((e: WheelEvent) => {
    const { selectedObjectId, objects, updateSelectedStyle, resizeObject } = useAnnotation.getState();
    if (!selectedObjectId) return;

    const obj = objects.find(o => o.id === selectedObjectId);
    if (!obj) return;

    e.preventDefault();

    // Accumulate raw deltaY so a trackpad gesture (dozens of small-delta
    // events) advances one step per threshold crossing instead of racing.
    const { step, nextAccum } = wheelResizeStep(wheelResizeAccum, e.deltaY);
    wheelResizeAccum = nextAccum;
    if (step === 0) return;

    const update = annotationResizeUpdates(obj, step);
    if (!update) return;
    if (update.kind === "style") updateSelectedStyle(update.updates);
    else resizeObject(obj.id, update.updates);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    stage = new Konva.Stage({
      container: containerRef.current,
      width: selection.width,
      height: selection.height,
    });

    layer = new Konva.Layer();
    stage.add(layer);
    applyLayerPixelRatio(layer, scaleFactor);

    transformer = new Konva.Transformer({
      rotateEnabled: true,
      keepRatio: false,
      shiftBehavior: "none",
      rotateAnchorCursor: cursorForAnnotationInteraction("rotate"),
      ...transformerAccentConfig(),
      anchorFill: "#ffffff",
      anchorSize: 8,
      rotateLineVisible: false,
      rotateAnchorOffset: ANNOTATION_ROTATE_ANCHOR_OFFSET,
      anchorStyleFunc: styleTransformerAnchor,
    });
    layer.add(transformer);

    // Handle drag end to persist position changes
    stage.on("dragend", (e) => {
      const node = getObjectNodeFromHit(e.target);
      if (!node) return;
      const { moveObject, resizeObject } = useAnnotation.getState();
      const obj = useAnnotation.getState().objects.find((o) => o.id === node.id());
      if (!obj) return;
      if (obj.type === "marker" && markerPartFromTarget(e.target) && node instanceof Konva.Group) {
        resizeObject(obj.id, markerPartDragUpdates(obj, node));
        return;
      }
      moveObject(obj.id, getNodeTransform(obj, node));
    });

    transformer.on("transformend", () => {
      const node = transformer?.nodes()[0];
      if (!node) return;
      const { resizeObject } = useAnnotation.getState();
      const obj = useAnnotation.getState().objects.find((o) => o.id === node.id());
      if (!obj) return;
      bakeLiveResizeIntoNode(obj, node);
      snapNodeRotationIfEnabled(obj, node);
      setStageCursor(cursorForAnnotationInteraction("drag"));
      resizeObject(obj.id, resizeUpdatesForTransformedObject(obj, node));
    });
    transformer.on("transformstart", (e) => {
      setStageCursor(isNodeInTree(e.target, transformer) ? "grabbing" : cursorForAnnotationInteraction("rotate"));
    });
    transformer.on("transform", () => {
      const node = transformer?.nodes()[0];
      if (!node) return;
      const obj = useAnnotation.getState().objects.find((o) => o.id === node.id());
      if (!obj) return;
      const didBakeResize = bakeLiveResizeIntoNode(obj, node);
      snapNodeRotationIfEnabled(obj, node);
      if (didBakeResize) transformer?.forceUpdate();
      refreshLivePositionDependentNode(previewObjectForNodeTransform(obj, node), node);
      layer?.batchDraw();
    });
    transformer.on("mouseenter", (e) => {
      const isRotater = e.target.name().includes("rotater");
      setStageCursor(cursorForAnnotationInteraction(isRotater ? "rotate" : "resize"));
    });
    transformer.on("mouseleave", () => setStageCursor(toolCursor()));

    // Existing annotations can be moved regardless of the current drawing tool.
    stage.on("dragstart", (e) => {
      if (isEditOverlayNode(e.target)) return;
      if (isTransformerNode(e.target)) return;
      const node = getObjectNodeFromHit(e.target);
      const { activeTool, setSelectedObject } = useAnnotation.getState();
      if (!node || activeTool === "eraser") {
        e.target.stopDrag();
        return;
      }
      setStageCursor("grabbing");
      const obj = useAnnotation.getState().objects.find((o) => o.id === node.id());
      if (obj?.type === "marker" && markerPartFromTarget(e.target)) {
        // Marker parts drag independently; selection shows no transformer chrome.
        setSelectedObject(node.id());
        return;
      }
      setSelectedObject(node.id());
      transformer?.nodes([node]);
      transformer?.moveToTop();
      getLayer()?.batchDraw();
    });
    stage.on("dragmove", (e) => {
      if (isEditOverlayNode(e.target)) return;
      if (isTransformerNode(e.target)) return;
      const node = getObjectNodeFromHit(e.target);
      if (!node) return;

      const obj = useAnnotation.getState().objects.find((o) => o.id === node.id());
      if (!obj) return;

      if (obj.type === "marker" && markerPartFromTarget(e.target)) {
        if (node instanceof Konva.Group) updateMarkerObjectNode(node);
        // dragstart selected this marker; keep the rings on the live parts.
        renderMarkerSelectionChrome(obj);
        layer?.batchDraw();
        return;
      }

      const nextObj = objectWithNodeTransform(obj, node);
      refreshLivePositionDependentNode(nextObj, node);
      if (isEndpointEditableObject(obj)) {
        moveLineEditHandles(nextObj);
      }
      layer?.batchDraw();
    });
    stage.on("dragend", () => setStageCursor(cursorForAnnotationInteraction("drag")));
    stage.on("mousemove", (e) => {
      if (useAnnotation.getState().drawingState === "active") return;
      if (isEditOverlayNode(e.target)) {
        setStageCursor(cursorForAnnotationInteraction("point"));
        return;
      }
      if (isTransformerNode(e.target)) {
        const isRotater = e.target.name().includes("rotater");
        setStageCursor(cursorForAnnotationInteraction(isRotater ? "rotate" : "resize"));
        return;
      }
      const node = getObjectNodeFromHit(e.target);
      const obj = node ? useAnnotation.getState().objects.find((o) => o.id === node.id()) : undefined;
      if (obj && !isEndpointEditableObject(obj) && useAnnotation.getState().activeTool !== "eraser") {
        setStageCursor(cursorForAnnotationInteraction("drag"));
        return;
      }
      setStageCursor(toolCursor());
    });
    stage.on("mouseleave", () => setStageCursor(toolCursor()));

    const div = containerRef.current;
    div.addEventListener("wheel", onWheel, { passive: false });

    forceRender((n) => n + 1);

    return () => {
      div.removeEventListener("wheel", onWheel);
      stage?.destroy();
      stage = null;
      layer = null;
      transformer = null;
      lineEditGroup = null;
      markerSelectionGroup = null;
      magnifierSourceImage = null;
      magnifierSourceRect = null;
      focusPreview = null;
    };
  }, [onWheel]);

  useEffect(() => {
    magnifierScaleFactor = scaleFactor;
  }, [scaleFactor]);

  useEffect(() => {
    magnifierSourceRect = frameSourceRect ?? null;
  }, [frameSourceRect]);

  useEffect(() => {
    if (!frameUrl || !needsMagnifierSource) {
      magnifierSourceImage = null;
      return;
    }

    let loadedImage: HTMLImageElement | null = null;
    const release = loadReleasableFrameImage(frameUrl, {
      onLoad: (image) => {
        loadedImage = image;
        magnifierSourceImage = image;
        useAnnotation.getState().objects
          .filter((object) => object.type === "magnifier")
          .forEach((object) => replaceRenderedObjectNode(object));
        layer?.batchDraw();
      },
      onError: (error) => {
        magnifierSourceImage = null;
        console.warn("Failed to load annotation magnifier frame", error);
      },
    });

    return () => {
      release();
      if (loadedImage && magnifierSourceImage === loadedImage) {
        magnifierSourceImage = null;
      }
    };
  }, [frameUrl, needsMagnifierSource]);

  useEffect(() => {
    if (!stage || interacting) return;
    stage.width(selection.width);
    stage.height(selection.height);
    if (layer) applyLayerPixelRatio(layer, scaleFactor);

    const contextObjects = useAnnotation.getState().objects.filter(usesRenderContext);
    for (const obj of contextObjects) {
      replaceRenderedObjectNode(obj);
    }
    if (contextObjects.length > 0) {
      syncSelectionWithStore(useAnnotation.getState().selectedObjectId);
    }

    syncFocusMask();
    stage.batchDraw();
  }, [
    selection.width,
    selection.height,
    scaleFactor,
    frameSourceRect?.x,
    frameSourceRect?.y,
    frameSourceRect?.width,
    frameSourceRect?.height,
    interacting,
  ]);

  // Sync Konva layer with store objects and selection (handles undo/redo/style/transform)
  useEffect(() => {
    return useAnnotation.subscribe((state, prev) => {
      if (state.objects !== prev.objects) {
        syncLayerWithStore(prev.objects);
        return;
      }
      if (state.selectedObjectId !== prev.selectedObjectId) {
        syncSelectionWithStore(state.selectedObjectId);
      }
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextInputLike(document.activeElement)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;

      const { selectedObjectId, deleteObject } = useAnnotation.getState();
      if (!selectedObjectId) return;

      event.preventDefault();
      deleteObject(selectedObjectId);
      setMarkerEditing((editing) => (
        editing?.object.id === selectedObjectId ? null : editing
      ));
      setTextEditing((editing) => (
        editing?.editingObject?.id === selectedObjectId ? null : editing
      ));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;

    // Let resize handle clicks pass through to overlay
    if (hitTestHandle({ x: e.clientX, y: e.clientY }, selection, 10)) return;

    const { activeTool: tool, activeStyle, objects, selectedObjectId, setSelectedObject, setDrawingState } = useAnnotation.getState();
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const stageInst = getStage();
    const hitTarget = stageInst?.getIntersection({ x, y }) ?? null;
    if (isEditOverlayNode(hitTarget)) {
      e.stopPropagation();
      return;
    }
    if (isTransformerNode(hitTarget)) {
      e.stopPropagation();
      return;
    }
    const hitNode = getObjectNodeFromHit(hitTarget);
    const hitObject = hitNode ? objects.find((o) => o.id === hitNode.id()) : undefined;

    if (tool !== "eraser" && hitObject?.type === "marker" && hitNode) {
      e.stopPropagation();
      if (e.detail >= 2) {
        openMarkerEditor(hitObject);
      } else {
        setSelectedObject(hitObject.id);
      }
      return;
    }

    // Keep single-click available for selecting/dragging text. Double-click reopens editing.
    if (tool === "text" && hitObject?.type === "text" && hitNode && e.detail >= 2) {
      e.stopPropagation();
      hitNode.destroy();
      getLayer()?.batchDraw();
      useAnnotation.getState().deleteObject(hitObject.id);
      textKeyRef.current++;
      setTextEditing({ position: { x: e.clientX, y: e.clientY }, editingObject: hitObject, key: textKeyRef.current });
      return;
    }

    // Smart click-to-select: check if clicking on existing object
    if (tool !== "eraser" && hitObject && hitNode) {
      e.stopPropagation();
      setSelectedObject(hitObject.id);
      return;
    }

    if (tool === "select") {
      setSelectedObject(null);
      if (transformer) {
        transformer.nodes([]);
        getLayer()?.batchDraw();
      }
      return;
    }

    // Prevent overlay from interpreting annotation tool clicks as move/drag.
    e.stopPropagation();

    if (shouldDeselectOnEmptyClick(selectedObjectId, tool)) {
      setSelectedObject(null);
      return;
    }

    // Text tool handled separately (no drag)
    if (tool === "text") {
      // If already editing text, confirm it at its original position first
      if (textEditing && textFlushRef.current) {
        textFlushRef.current();
      }
      if (selectedObjectId) {
        setSelectedObject(null);
      }
      textKeyRef.current++;
      setTextEditing({ position: { x: e.clientX, y: e.clientY }, editingObject: null, key: textKeyRef.current });
      return;
    }

    // Eraser
    if (tool === "eraser") {
      setDrawingState("active");
      clearFocusPreview();
      onEraserStart(x, y);
      return;
    }

    // Start drawing with current tool
    const handlers = TOOL_HANDLERS[tool];
    if (handlers) {
      setDrawingState("active");
      handlers.start(x, y);
      beginFocusPreview(tool, { x, y }, activeStyle);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { activeTool: tool, drawingState } = useAnnotation.getState();
    if (drawingState !== "active") return;

    e.stopPropagation();
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === "eraser") {
      onEraserMove(x, y);
      return;
    }

    const handlers = TOOL_HANDLERS[tool];
    if (handlers) {
      handlers.move(x, y);
      updateFocusPreview({ x, y });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const { activeTool: tool, drawingState, setDrawingState, addObject, setSelectedObject } = useAnnotation.getState();

    if (drawingState !== "active") return;

    e.stopPropagation();
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === "eraser") {
      onEraserEnd();
      setDrawingState("idle");
      return;
    }

    const handlers = TOOL_HANDLERS[tool];
    if (handlers) {
      const obj = handlers.end(x, y);
      clearFocusPreview(false);
      if (obj) {
        addObject(obj);
        if (obj.type === "marker") {
          openMarkerEditor(obj);
        } else if (obj.type === "magnifier") {
          setSelectedObject(obj.id);
        }
      } else {
        syncFocusMask();
      }
    }
    setDrawingState("idle");
  };

  const cursor = stageCursorForTool(activeTool, activeStyle, colorPickerVisible);

  return (
    <>
      <div
        ref={containerRef}
        data-annotation-stage
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          position: "absolute",
          left: selection.x,
          top: selection.y,
          width: selection.width,
          height: selection.height,
          cursor,
          pointerEvents: interacting ? "none" : "auto",
          visibility: "visible",
        }}
      />
      {markerEditing && (
        <MarkerTextOverlay
          key={markerEditing.key}
          object={markerEditing.object}
          selection={selection}
          viewportOrigin={viewportOrigin}
          onConfirm={(text) => {
            const editingObject = markerEditing.object;
            useAnnotation.getState().resizeObject(editingObject.id, {
              text,
              // The first non-empty confirm fixes the label anchor; later edits
              // keep the user's anchor. Empty confirms must not bake an anchor,
              // otherwise text added after moving the badge would appear at the
              // original placement position.
              end: text ? markerLabelAnchor({ ...editingObject, text }) : editingObject.end,
            });
            setMarkerEditing(null);
          }}
          onCancel={() => setMarkerEditing(null)}
        />
      )}
      {textEditing && (
        <TextOverlay
          key={textEditing.key}
          position={textEditing.position}
          selection={selection}
          editingObject={textEditing.editingObject}
          viewportOrigin={viewportOrigin}
          flushRef={textFlushRef}
          onConfirm={(obj) => {
            addTextToLayer(obj);
            useAnnotation.getState().addObject(obj);
            setTextEditing(null);
          }}
          onCancel={() => setTextEditing(null)}
        />
      )}
    </>
  );
}
