import type { ImageAdjustments } from "@/lib/types";

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  grayscale: false,
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

export const PREVIEW_IMAGE_ADJUSTMENTS_FILTER_ID = "preview-image-adjustments-filter";

function clampNumber(value: unknown, min: number, max: number): number {
  const finite = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, Math.round(finite)));
}

export function normalizeImageAdjustments(adjustments: Partial<ImageAdjustments> = {}): ImageAdjustments {
  return {
    grayscale: adjustments.grayscale ?? DEFAULT_IMAGE_ADJUSTMENTS.grayscale,
    brightness: clampNumber(adjustments.brightness, -100, 100),
    contrast: clampNumber(adjustments.contrast, -100, 100),
    saturation: clampNumber(adjustments.saturation, -100, 100),
  };
}

export function hasImageAdjustments(adjustments: ImageAdjustments): boolean {
  const normalized = normalizeImageAdjustments(adjustments);
  return (
    normalized.grayscale ||
    normalized.brightness !== 0 ||
    normalized.contrast !== 0 ||
    normalized.saturation !== 0
  );
}

export function frozenLayerFilterForImageAdjustments(adjustments: ImageAdjustments): string {
  const normalized = normalizeImageAdjustments(adjustments);
  return hasImageAdjustments(normalized)
    ? `url(#${PREVIEW_IMAGE_ADJUSTMENTS_FILTER_ID})`
    : "none";
}

/** One affine transform keeps SVG's intermediate clamping from changing the
 * result of the backend's grayscale -> brightness -> contrast -> saturation. */
export function imageAdjustmentMatrix(adjustments: ImageAdjustments): number[] {
  const value = normalizeImageAdjustments(adjustments);
  const contrast = 1 + value.contrast / 100;
  const saturation = value.grayscale ? 0 : 1 + value.saturation / 100;
  const offset = contrast * value.brightness / 100 + (128 / 255) * (1 - contrast);
  const luma = [0.299, 0.587, 0.114];
  return [0, 1, 2].flatMap((row) => [
    ...luma.map((weight, column) => contrast * (weight * (1 - saturation) + (row === column ? saturation : 0))),
    0, offset,
  ]).concat([0, 0, 0, 1, 0]);
}
