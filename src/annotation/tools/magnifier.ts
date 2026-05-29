import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { MagnifierRenderContext } from "@/annotation/magnifierContext";
import type { AnnotationObject, AnnotationStyle, MagnifierShape } from "@/annotation/types";
import type { Point } from "@/lib/types";

const MIN_LENS_SIZE = 12;
const MAGNIFIER_BORDER_WIDTH = 4;
const MAGNIFIER_BORDER_RGB = "156, 163, 175";
const MAGNIFIER_BORDER_ALPHAS = [0.72, 0.5, 0.3, 0.14];

type MagnifierAnnotationNode = Konva.Group | Konva.Shape;
type RenderMagnifierAnnotation = (obj: AnnotationObject) => MagnifierAnnotationNode | null;
type MagnifierBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

let startX = 0;
let startY = 0;
let currentLens: Konva.Rect | null = null;

function boundsForObject(obj: AnnotationObject): MagnifierBounds {
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? start;
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function magnifierLensBounds(obj: AnnotationObject): MagnifierBounds {
  const bounds = boundsForObject(obj);
  if (magnifierShape(obj.style) !== "circle") return bounds;

  const size = Math.min(bounds.width, bounds.height);
  return {
    x: bounds.x + (bounds.width - size) / 2,
    y: bounds.y + (bounds.height - size) / 2,
    width: size,
    height: size,
  };
}

export function magnifierBasePosition(obj: AnnotationObject): Point {
  const bounds = magnifierLensBounds(obj);
  return { x: bounds.x, y: bounds.y };
}

function visualBoundsForObject(obj: AnnotationObject): MagnifierBounds {
  const bounds = magnifierLensBounds(obj);
  const width = bounds.width * Math.abs(obj.transform.scaleX);
  const height = bounds.height * Math.abs(obj.transform.scaleY);

  return {
    x: bounds.x + obj.transform.x + (obj.transform.scaleX < 0 ? -width : 0),
    y: bounds.y + obj.transform.y + (obj.transform.scaleY < 0 ? -height : 0),
    width,
    height,
  };
}

function magnifierShape(style: AnnotationStyle): MagnifierShape {
  return style.magnifierShape === "rounded-rect" ? "rounded-rect" : "circle";
}

function magnifierZoom(style: AnnotationStyle): number {
  const zoom = style.magnifierZoom ?? 2;
  return Number.isFinite(zoom) ? Math.max(2, Math.min(4, zoom)) : 2;
}

export function magnifierContentPosition(
  bounds: MagnifierBounds,
  zoom: number,
): { x: number; y: number } {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    x: bounds.width / 2 - centerX * zoom,
    y: bounds.height / 2 - centerY * zoom,
  };
}

function borderStroke(alpha: number): string {
  return `rgba(${MAGNIFIER_BORDER_RGB}, ${alpha})`;
}

function rectFromNode(node: Konva.Node): MagnifierBounds {
  const shape = node as Konva.Shape;
  const width = Math.max(MIN_LENS_SIZE, shape.width() * Math.abs(node.scaleX()));
  const height = Math.max(MIN_LENS_SIZE, shape.height() * Math.abs(node.scaleY()));
  return {
    x: node.scaleX() < 0 ? node.x() - width : node.x(),
    y: node.scaleY() < 0 ? node.y() - height : node.y(),
    width,
    height,
  };
}

export function magnifierResizeUpdatesFromNode(
  obj: AnnotationObject,
  node: Konva.Node,
): Partial<AnnotationObject> {
  const rect = rectFromNode(node);
  if (magnifierShape(obj.style) !== "circle") {
    return {
      start: { x: rect.x, y: rect.y },
      end: { x: rect.x + rect.width, y: rect.y + rect.height },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
  }

  const size = Math.min(rect.width, rect.height);
  const x = rect.x + (rect.width - size) / 2;
  const y = rect.y + (rect.height - size) / 2;
  return {
    start: { x, y },
    end: { x: x + size, y: y + size },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

export function onMagnifierStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  startX = x;
  startY = y;

  currentLens = new Konva.Rect({
    x,
    y,
    width: 0,
    height: 0,
    stroke: borderStroke(MAGNIFIER_BORDER_ALPHAS[0]),
    strokeWidth: MAGNIFIER_BORDER_WIDTH,
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

function disableMagnifierSourceInteractions(node: Konva.Node) {
  node.id("");
  node.listening(false);
  node.draggable(false);

  const maybeContainer = node as Konva.Container;
  if (typeof maybeContainer.getChildren === "function") {
    maybeContainer.getChildren().forEach(disableMagnifierSourceInteractions);
  }
}

function addMagnifiedAnnotations(
  content: Konva.Group,
  context: MagnifierRenderContext,
  renderAnnotation?: RenderMagnifierAnnotation,
) {
  if (!renderAnnotation) return;

  const annotations = new Konva.Group({
    name: "magnifier-annotations",
    listening: false,
  });

  for (const object of context.objects) {
    if (object.type === "magnifier") continue;
    const node = renderAnnotation(object);
    if (!node) continue;
    disableMagnifierSourceInteractions(node);
    annotations.add(node);
  }

  if (annotations.getChildren().length > 0) content.add(annotations);
}

function addMagnifiedContent(
  clip: Konva.Group,
  bounds: MagnifierBounds,
  context: MagnifierRenderContext,
  zoom: number,
  renderAnnotation?: RenderMagnifierAnnotation,
) {
  const position = magnifierContentPosition(bounds, zoom);

  const content = new Konva.Group({
    name: "magnifier-content",
    x: position.x,
    y: position.y,
    scaleX: zoom,
    scaleY: zoom,
    listening: false,
  });

  content.add(new Konva.Image({
    name: "magnifier-image",
    image: context.sourceImage,
    x: 0,
    y: 0,
    width: context.stageSize.width,
    height: context.stageSize.height,
    listening: false,
  }));

  addMagnifiedAnnotations(content, context, renderAnnotation);
  clip.add(content);
}

function setMagnifierClip(
  clip: Konva.Group,
  bounds: MagnifierBounds,
  shape: MagnifierShape,
) {
  clip.setAttrs({
    width: bounds.width,
    height: bounds.height,
  });
  clip.clipFunc((ctx) => {
    if (shape === "circle") {
      const radius = Math.min(bounds.width, bounds.height) / 2;
      ctx.arc(bounds.width / 2, bounds.height / 2, radius, 0, Math.PI * 2);
      return;
    }

    ctx.rect(0, 0, bounds.width, bounds.height);
  });
}

function addMagnifierBorder(group: Konva.Group, bounds: MagnifierBounds, shape: MagnifierShape) {
  const ringCount = MAGNIFIER_BORDER_WIDTH;
  for (let index = 0; index < ringCount; index++) {
    const inset = index + 0.5;
    const common = {
      name: "magnifier-border magnifier-border-ring",
      stroke: borderStroke(MAGNIFIER_BORDER_ALPHAS[index] ?? MAGNIFIER_BORDER_ALPHAS[MAGNIFIER_BORDER_ALPHAS.length - 1]),
      strokeWidth: 1,
      fillEnabled: false,
      listening: false,
    };

    if (shape === "circle") {
      const radius = Math.max(0, Math.min(bounds.width, bounds.height) / 2 - inset);
      group.add(new Konva.Circle({
        ...common,
        x: bounds.width / 2,
        y: bounds.height / 2,
        radius,
      }));
      continue;
    }

    group.add(new Konva.Rect({
      ...common,
      x: inset,
      y: inset,
      width: Math.max(0, bounds.width - inset * 2),
      height: Math.max(0, bounds.height - inset * 2),
      cornerRadius: 0,
    }));
  }
}

export function renderMagnifierObject(
  obj: AnnotationObject,
  context?: MagnifierRenderContext | null,
  renderAnnotation?: RenderMagnifierAnnotation,
): Konva.Group {
  const visualBounds = visualBoundsForObject(obj);
  const transform = obj.transform;
  const shape = magnifierShape(obj.style);
  const zoom = magnifierZoom(obj.style);
  const group = new Konva.Group({
    id: obj.id,
    x: visualBounds.x,
    y: visualBounds.y,
    width: visualBounds.width,
    height: visualBounds.height,
    scaleX: 1,
    scaleY: 1,
    rotation: transform.rotation,
    draggable: true,
  });

  const clip = new Konva.Group({
    name: "magnifier-clip",
  });
  setMagnifierClip(clip, visualBounds, shape);

  if (context?.sourceImage) {
    addMagnifiedContent(clip, visualBounds, context, zoom, renderAnnotation);
  }

  group.add(clip);
  addMagnifierBorder(group, visualBounds, shape);

  return group;
}

export function refreshMagnifierObjectNode(node: Konva.Node, obj: AnnotationObject): boolean {
  if (!(node instanceof Konva.Group)) return false;

  const visualBounds = visualBoundsForObject(obj);
  const shape = magnifierShape(obj.style);
  const zoom = magnifierZoom(obj.style);
  node.setAttrs({
    x: visualBounds.x,
    y: visualBounds.y,
    width: visualBounds.width,
    height: visualBounds.height,
    scaleX: 1,
    scaleY: 1,
    rotation: obj.transform.rotation,
  });

  const clip = node.findOne(".magnifier-clip") as Konva.Group | undefined;
  if (clip) setMagnifierClip(clip, visualBounds, shape);

  const content = node.findOne(".magnifier-content") as Konva.Group | undefined;
  if (content) {
    content.position(magnifierContentPosition(visualBounds, zoom));
    content.scale({ x: zoom, y: zoom });
  }

  node.find(".magnifier-border-ring").forEach((ring) => ring.destroy());
  addMagnifierBorder(node, visualBounds, shape);

  return true;
}
