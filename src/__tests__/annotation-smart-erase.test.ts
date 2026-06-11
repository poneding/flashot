/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { smartErase, type PaddedSample } from "@/annotation/tools/blur";

// jsdom does not implement ImageData. smartErase only touches width/height/data,
// so a minimal test-only polyfill is enough. Production code uses the real one.
class ImageDataPolyfill {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

if (typeof globalThis.ImageData === "undefined") {
  (globalThis as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

type Rgb = [number, number, number];

type Pads = { left: number; top: number; right: number; bottom: number };

function makeSample(width: number, height: number, pads: Pads, ring: Rgb, interior: Rgb): PaddedSample {
  const imageData = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inInterior =
        x >= pads.left && x < width - pads.right && y >= pads.top && y < height - pads.bottom;
      const [r, g, b] = inInterior ? interior : ring;
      const i = (y * width + x) * 4;
      imageData.data[i] = r;
      imageData.data[i + 1] = g;
      imageData.data[i + 2] = b;
      imageData.data[i + 3] = 255;
    }
  }
  return { imageData, padLeft: pads.left, padTop: pads.top, padRight: pads.right, padBottom: pads.bottom };
}

function paintColumn(imageData: ImageData, x: number, [r, g, b]: Rgb) {
  for (let y = 0; y < imageData.height; y++) {
    const i = (y * imageData.width + x) * 4;
    imageData.data[i] = r;
    imageData.data[i + 1] = g;
    imageData.data[i + 2] = b;
    imageData.data[i + 3] = 255;
  }
}

function pixelAt(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * imageData.width + x) * 4;
  return [imageData.data[i], imageData.data[i + 1], imageData.data[i + 2], imageData.data[i + 3]];
}

describe("smartErase", () => {
  it("fills the interior with the surrounding color for a uniform ring", () => {
    const sample = makeSample(24, 24, { left: 4, top: 4, right: 4, bottom: 4 }, [255, 255, 255], [0, 255, 0]);

    const result = smartErase(sample);

    expect(result.width).toBe(24);
    expect(result.height).toBe(24);
    const [r, g, b, a] = pixelAt(result, 12, 12);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeGreaterThan(240);
    expect(b).toBeGreaterThan(240);
    expect(a).toBe(255);
  });

  it("blends opposing ring colors across the interior", () => {
    const sample = makeSample(24, 24, { left: 4, top: 4, right: 4, bottom: 4 }, [128, 128, 128], [0, 0, 0]);
    // Left ring column red, right ring column blue, top/bottom rows stay gray.
    paintColumn(sample.imageData, 3, [255, 0, 0]);
    paintColumn(sample.imageData, 20, [0, 0, 255]);

    const result = smartErase(sample);

    const [centerR, , centerB] = pixelAt(result, 12, 12);
    expect(centerR).toBeGreaterThan(40);
    expect(centerB).toBeGreaterThan(40);
    const [leftR, , leftB] = pixelAt(result, 5, 12);
    expect(leftR).toBeGreaterThan(leftB);
    const [rightR, , rightB] = pixelAt(result, 18, 12);
    expect(rightB).toBeGreaterThan(rightR);
  });

  it("lets the nearer axis dominate: top-adjacent pixels follow the vertical rings", () => {
    // Green top/bottom rings, red left ring, blue right ring. A pixel touching
    // the top edge must be dominated by the vertical estimate (green), not the
    // horizontal red/blue lerp — pins the cross-axis weighting direction.
    const sample = makeSample(24, 24, { left: 4, top: 4, right: 4, bottom: 4 }, [0, 255, 0], [0, 0, 0]);
    paintColumn(sample.imageData, 3, [255, 0, 0]);
    paintColumn(sample.imageData, 20, [0, 0, 255]);

    const result = smartErase(sample);

    const [r, g, b] = pixelAt(result, 12, 4);
    expect(g).toBeGreaterThan(200);
    expect(r).toBeLessThan(50);
    expect(b).toBeLessThan(50);
  });

  it("fills from the remaining sides when one pad is fully clamped", () => {
    const sample = makeSample(20, 24, { left: 0, top: 4, right: 4, bottom: 4 }, [200, 100, 50], [0, 255, 0]);

    const result = smartErase(sample);

    const [r, g, b, a] = pixelAt(result, 8, 12);
    expect(a).toBe(255);
    expect(Math.abs(r - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - 50)).toBeLessThanOrEqual(2);
  });

  it("returns the region unchanged when every pad is clamped to zero", () => {
    const sample = makeSample(16, 16, { left: 0, top: 0, right: 0, bottom: 0 }, [255, 255, 255], [10, 20, 30]);

    const result = smartErase(sample);

    expect(result).not.toBe(sample.imageData);
    expect(Array.from(result.data)).toEqual(Array.from(sample.imageData.data));
  });

  it("returns a new ImageData without mutating the input", () => {
    const sample = makeSample(24, 24, { left: 4, top: 4, right: 4, bottom: 4 }, [255, 255, 255], [0, 255, 0]);
    const inputSnapshot = Uint8ClampedArray.from(sample.imageData.data);

    const result = smartErase(sample);

    expect(result).not.toBe(sample.imageData);
    expect(Array.from(sample.imageData.data)).toEqual(Array.from(inputSnapshot));
    expect(pixelAt(result, 12, 12)).not.toEqual(pixelAt(sample.imageData, 12, 12));
  });
});
