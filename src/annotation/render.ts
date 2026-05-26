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
import type { StageSize } from "@/annotation/focus";

type LayerChild = Konva.Group | Konva.Shape;

export function renderObject(obj: AnnotationObject, stageSize?: StageSize): LayerChild | null {
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
    default: return null;
  }
}
