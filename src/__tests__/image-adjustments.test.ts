import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_ADJUSTMENTS, imageAdjustmentMatrix } from "@/overlay/imageAdjustments";
import type { ImageAdjustments } from "@/lib/types";

function previewPixel(pixel: number[], adjustments: Partial<ImageAdjustments>) {
  const matrix = imageAdjustmentMatrix({ ...DEFAULT_IMAGE_ADJUSTMENTS, ...adjustments });
  return [0, 1, 2].map((row) => {
    const offset = row * 5;
    const value = matrix[offset + 4] * 255
      + pixel.reduce((sum, channel, index) => sum + channel * matrix[offset + index], 0);
    return Math.min(255, Math.max(0, Math.round(value + 1e-8)));
  });
}

describe("preview and exported adjustment colors", () => {
  it("adds brightness to black pixels using the export's channel offset", () => {
    expect(previewPixel([0, 0, 0], { brightness: 50 })).toEqual([128, 128, 128]);
  });

  it("clamps after all adjustments instead of clipping between brightness and contrast", () => {
    expect(previewPixel([240, 10, 20], { brightness: 100, contrast: -50 })).toEqual([255, 197, 202]);
  });

  it("uses the same grayscale weights and keeps grayscale neutral after saturation", () => {
    expect(previewPixel([255, 0, 0], { grayscale: true, saturation: 100 })).toEqual([76, 76, 76]);
  });
});
