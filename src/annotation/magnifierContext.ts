import { convertFileSrc } from "@tauri-apps/api/core";
import type { AnnotationObject } from "@/annotation/types";
import type { StageSize } from "@/annotation/focus";

const ASSET_LOCALHOST_PREFIX = "asset://localhost/";

function decodeAssetPath(path: string) {
  if (!path.includes("%")) return path;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function annotationFrameSourceFromUrl(url: string): string {
  if (!url.startsWith(ASSET_LOCALHOST_PREFIX)) return url;

  const path = decodeAssetPath(url.slice(ASSET_LOCALHOST_PREFIX.length));
  try {
    return convertFileSrc(path);
  } catch {
    return url;
  }
}

export type MagnifierRenderContext = {
  sourceImage: HTMLImageElement;
  stageSize: StageSize;
  scaleFactor: number;
  objects: AnnotationObject[];
};

export function createMagnifierRenderContext({
  sourceImage,
  stageSize,
  scaleFactor,
  objects,
  excludeObjectId,
}: {
  sourceImage: HTMLImageElement;
  stageSize: StageSize;
  scaleFactor: number;
  objects: AnnotationObject[];
  excludeObjectId?: string;
}): MagnifierRenderContext {
  return {
    sourceImage,
    stageSize,
    scaleFactor,
    objects: excludeObjectId
      ? objects.filter((object) => object.id !== excludeObjectId)
      : [...objects],
  };
}
