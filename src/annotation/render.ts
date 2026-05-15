import Konva from "konva";
import type { AnnotationObject } from "@/annotation/types";
import { renderDrawObject } from "@/annotation/tools/draw";
import { renderLineObject } from "@/annotation/tools/line";
import { renderRectObject } from "@/annotation/tools/rect";
import { renderEllipseObject } from "@/annotation/tools/ellipse";
import { renderHighlightObject } from "@/annotation/tools/highlight";
import { renderBlurObject } from "@/annotation/tools/blur";
import { renderTextObject } from "@/annotation/tools/text";

type LayerChild = Konva.Group | Konva.Shape;

export function renderObject(obj: AnnotationObject): LayerChild | null {
  switch (obj.type) {
    case "draw": return renderDrawObject(obj);
    case "line": return renderLineObject(obj);
    case "arrow": return renderLineObject(obj);
    case "rect": return renderRectObject(obj);
    case "ellipse": return renderEllipseObject(obj);
    case "highlight": return renderHighlightObject(obj);
    case "blur": return renderBlurObject(obj) as LayerChild | null;
    case "text": return renderTextObject(obj);
    default: return null;
  }
}
