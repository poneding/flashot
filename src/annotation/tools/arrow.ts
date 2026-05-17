import { useAnnotation } from "@/annotation/store";
import { onLineStart, onLineMove, onLineEnd } from "@/annotation/tools/line";
import type { AnnotationObject } from "@/annotation/types";

export function onArrowStart(x: number, y: number) {
  onLineStart(x, y);
}

export function onArrowMove(x: number, y: number) {
  onLineMove(x, y);
}

export function onArrowEnd(x: number, y: number): AnnotationObject | null {
  // Temporarily force arrow: "end" so onLineEnd adds the arrowhead
  const store = useAnnotation.getState();
  const prevArrow = store.activeStyle.arrow;
  const prevLineShape = store.activeStyle.lineShape;
  store.setActiveStyle({ arrow: "end", lineShape: "straight" });

  const obj = onLineEnd(x, y);

  // Restore previous arrow/line settings
  store.setActiveStyle({ arrow: prevArrow, lineShape: prevLineShape });

  if (obj) {
    obj.type = "arrow";
    obj.style.arrow = "end";
    obj.style.lineShape = "straight";
  }
  return obj;
}
