import Konva from "konva";
import type { AnnotationObject } from "@/annotation/types";
import { renderDrawObject } from "@/annotation/tools/draw";
import { renderLineObject } from "@/annotation/tools/line";
import { renderMeasureObject } from "@/annotation/tools/measure";
import { renderRectObject } from "@/annotation/tools/rect";
import { renderEllipseObject } from "@/annotation/tools/ellipse";
import { renderHighlightObject } from "@/annotation/tools/highlight";
import { renderBlurObject } from "@/annotation/tools/blur";
import { renderTextObject } from "@/annotation/tools/text";
import { renderMarkerObject } from "@/annotation/tools/marker";
import { renderMagnifierObject } from "@/annotation/tools/magnifier";
import type { StageSize } from "@/annotation/focus";
import type { MagnifierRenderContext } from "@/annotation/magnifierContext";

type LayerChild = Konva.Group | Konva.Shape;

export type AnnotationRenderContext = StageSize | {
  stageSize?: StageSize;
  magnifier?: MagnifierRenderContext | null;
};

function stageSizeFromContext(context?: AnnotationRenderContext): StageSize | undefined {
  if (!context) return undefined;
  if ("width" in context && "height" in context) return context;
  return context.stageSize;
}

function magnifierContextFromContext(context?: AnnotationRenderContext): MagnifierRenderContext | null | undefined {
  if (!context || ("width" in context && "height" in context)) return undefined;
  return context.magnifier;
}

export function renderObject(obj: AnnotationObject, context?: AnnotationRenderContext): LayerChild | null {
  const stageSize = stageSizeFromContext(context);
  switch (obj.type) {
    case "draw": return renderDrawObject(obj);
    case "line": return renderLineObject(obj);
    case "arrow": return renderLineObject(obj);
    case "measure": return renderMeasureObject(obj);
    case "rect": return stageSize ? renderRectObject(obj, stageSize) : renderRectObject(obj);
    case "ellipse": return stageSize ? renderEllipseObject(obj, stageSize) : renderEllipseObject(obj);
    case "highlight": return renderHighlightObject(obj);
    case "blur": return renderBlurObject(obj) as LayerChild | null;
    case "text": return renderTextObject(obj);
    case "marker": return renderMarkerObject(obj);
    case "magnifier": return renderMagnifierObject(obj, magnifierContextFromContext(context));
    default: return null;
  }
}
