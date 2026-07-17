import { onLineStart, onLineMove, onLineEnd } from "@/annotation/tools/line";
import type { AnnotationObject } from "@/annotation/types";

export function onArrowStart(x: number, y: number) {
  onLineStart(x, y);
}

export function onArrowMove(x: number, y: number) {
  onLineMove(x, y);
}

export function onArrowEnd(x: number, y: number): AnnotationObject | null {
  return onLineEnd(x, y, "arrow");
}
