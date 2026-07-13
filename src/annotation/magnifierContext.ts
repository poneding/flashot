import type { AnnotationObject } from "@/annotation/types";
import type { StageSize } from "@/annotation/focus";
import type { Rect } from "@/lib/types";

export type MagnifierRenderContext = {
  sourceImage: HTMLImageElement;
  stageSize: StageSize;
  scaleFactor: number;
  sourceRect?: Rect | null;
  objects: AnnotationObject[];
};

export function createMagnifierRenderContext({
  sourceImage,
  stageSize,
  scaleFactor,
  sourceRect,
  objects,
  excludeObjectId,
}: {
  sourceImage: HTMLImageElement;
  stageSize: StageSize;
  scaleFactor: number;
  sourceRect?: Rect | null;
  objects: AnnotationObject[];
  excludeObjectId?: string;
}): MagnifierRenderContext {
  return {
    sourceImage,
    stageSize,
    scaleFactor,
    sourceRect,
    objects: excludeObjectId
      ? objects.filter((object) => object.id !== excludeObjectId)
      : [...objects],
  };
}
