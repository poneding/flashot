import type { ImageAdjustments } from "@/lib/types";

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  grayscale: false,
  autoLevels: false,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpness: 0,
};

function clampNumber(value: unknown, min: number, max: number): number {
  const finite = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, Math.round(finite)));
}

export function normalizeImageAdjustments(adjustments: Partial<ImageAdjustments> = {}): ImageAdjustments {
  return {
    grayscale: adjustments.grayscale ?? DEFAULT_IMAGE_ADJUSTMENTS.grayscale,
    autoLevels: adjustments.autoLevels ?? DEFAULT_IMAGE_ADJUSTMENTS.autoLevels,
    brightness: clampNumber(adjustments.brightness, -100, 100),
    contrast: clampNumber(adjustments.contrast, -100, 100),
    saturation: clampNumber(adjustments.saturation, -100, 100),
    sharpness: clampNumber(adjustments.sharpness, 0, 100),
  };
}

function formatRatio(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function frozenLayerFilterForImageAdjustments(adjustments: ImageAdjustments): string {
  const normalized = normalizeImageAdjustments(adjustments);
  const filters: string[] = [];

  if (normalized.grayscale) filters.push("grayscale(1)");

  const brightness = 1 + normalized.brightness / 100;
  if (brightness !== 1) filters.push(`brightness(${formatRatio(brightness)})`);

  const contrast = 1 + normalized.contrast / 100;
  if (contrast !== 1) filters.push(`contrast(${formatRatio(contrast)})`);

  const saturation = 1 + normalized.saturation / 100;
  if (saturation !== 1) filters.push(`saturate(${formatRatio(saturation)})`);

  return filters.length > 0 ? filters.join(" ") : "none";
}
