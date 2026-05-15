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
  store.setActiveStyle({ arrow: "end" });

  const obj = onLineEnd(x, y);

  // Restore previous arrow setting
  store.setActiveStyle({ arrow: prevArrow });

  if (obj) {
    obj.type = "arrow";
    obj.style.arrow = "end";
  }
  return obj;
}
