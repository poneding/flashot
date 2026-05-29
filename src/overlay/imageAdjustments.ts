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

export function cssFilterForImageAdjustments(adjustments: ImageAdjustments): string {
  const normalized = normalizeImageAdjustments(adjustments);
  if (!hasImageAdjustments(normalized)) return "none";

  const filters: string[] = [];
  if (normalized.grayscale) filters.push("grayscale(1)");
  if (normalized.brightness !== 0) filters.push(`brightness(${100 + normalized.brightness}%)`);
  if (normalized.contrast !== 0) filters.push(`contrast(${100 + normalized.contrast}%)`);
  if (normalized.saturation !== 0) filters.push(`saturate(${100 + normalized.saturation}%)`);
  return filters.join(" ");
}
