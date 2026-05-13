import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

let startX = 0;
let startY = 0;
let currentRect: Konva.Rect | null = null;
let currentPoints: number[] = [];
let currentLine: Konva.Line | null = null;

function pixelate(imageData: ImageData, blockSize: number): ImageData {
  const { data, width, height } = imageData;
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let dy = 0; dy < blockSize && y + dy < height; dy++) {
        for (let dx = 0; dx < blockSize && x + dx < width; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
          count++;
        }
      }
      r = Math.round(r / count); g = Math.round(g / count);
      b = Math.round(b / count); a = Math.round(a / count);
      for (let dy = 0; dy < blockSize && y + dy < height; dy++) {
        for (let dx = 0; dx < blockSize && x + dx < width; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = a;
        }
      }
    }
  }
  return out;
}

function getBackgroundImageData(x: number, y: number, w: number, h: number): ImageData | null {
  const bgImg = document.querySelector("[data-frozen-layer]") as HTMLImageElement | null;
  if (!bgImg) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bgImg, x, y, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function applyBlur(x: number, y: number, w: number, h: number, mode: "mosaic" | "gaussian", intensity: number): Konva.Image | null {
  const imageData = getBackgroundImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  if (!imageData) return null;
  const blurred = mode === "mosaic" ? pixelate(imageData, intensity) : gaussianBlur(imageData, intensity);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w); canvas.height = Math.round(h);
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(blurred, 0, 0);
  return new Konva.Image({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), image: canvas });
}

function gaussianBlur(imageData: ImageData, radius: number): ImageData {
  const { data, width, height } = imageData;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const size = radius * 2 + 1;
  const kernel: number[] = [];
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const val = Math.exp(-(x * x) / (2 * radius * radius));
    kernel.push(val);
    sum += val;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  const temp = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < size; k++) {
        const sx = Math.min(Math.max(x + k - radius, 0), width - 1);
        const i = (y * width + sx) * 4;
        r += data[i] * kernel[k]; g += data[i + 1] * kernel[k];
        b += data[i + 2] * kernel[k]; a += data[i + 3] * kernel[k];
      }
      const i = (y * width + x) * 4;
      temp[i] = r; temp[i + 1] = g; temp[i + 2] = b; temp[i + 3] = a;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < size; k++) {
        const sy = Math.min(Math.max(y + k - radius, 0), height - 1);
        const i = (sy * width + x) * 4;
        r += temp[i] * kernel[k]; g += temp[i + 1] * kernel[k];
        b += temp[i + 2] * kernel[k]; a += temp[i + 3] * kernel[k];
      }
      const i = (y * width + x) * 4;
      out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = a;
    }
  }
  return out;
}

export function onBlurStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;
  const { activeStyle } = useAnnotation.getState();
  startX = x; startY = y;

  if (activeStyle.blurMethod === "freehand") {
    currentPoints = [x, y];
    currentLine = new Konva.Line({
      points: currentPoints, stroke: "rgba(100,100,255,0.3)", strokeWidth: 20,
      lineCap: "round", lineJoin: "round", listening: false,
    });
    layer.add(currentLine);
  } else {
    currentRect = new Konva.Rect({
      x, y, width: 0, height: 0, stroke: "rgba(100,100,255,0.5)",
      strokeWidth: 1, dash: [4, 4], listening: false,
    });
    layer.add(currentRect);
  }
}

export function onBlurMove(x: number, y: number) {
  const { activeStyle } = useAnnotation.getState();
  if (activeStyle.blurMethod === "freehand" && currentLine) {
    currentPoints.push(x, y);
    currentLine.points([...currentPoints]);
  } else if (currentRect) {
    const w = x - startX; const h = y - startY;
    currentRect.x(w < 0 ? x : startX); currentRect.y(h < 0 ? y : startY);
    currentRect.width(Math.abs(w)); currentRect.height(Math.abs(h));
  }
  getLayer()?.batchDraw();
}

export function onBlurEnd(x: number, y: number): AnnotationObject | null {
  const layer = getLayer();
  const { activeStyle } = useAnnotation.getState();
  const intensity = activeStyle.blurIntensity ?? 10;

  if (activeStyle.blurMethod === "freehand" && currentLine) {
    currentLine.destroy(); currentLine = null;
    if (currentPoints.length < 4) { currentPoints = []; return null; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < currentPoints.length; i += 2) {
      minX = Math.min(minX, currentPoints[i]); minY = Math.min(minY, currentPoints[i + 1]);
      maxX = Math.max(maxX, currentPoints[i]); maxY = Math.max(maxY, currentPoints[i + 1]);
    }
    const pad = 10; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const blurImage = applyBlur(minX, minY, maxX - minX, maxY - minY, activeStyle.blurMode ?? "mosaic", intensity);
    if (!blurImage || !layer) { currentPoints = []; return null; }
    const id = crypto.randomUUID();
    blurImage.id(id); blurImage.listening(true);
    layer.add(blurImage); layer.batchDraw();
    const obj: AnnotationObject = {
      id, type: "blur", points: [...currentPoints],
      start: { x: minX, y: minY }, end: { x: maxX, y: maxY },
      style: { ...activeStyle }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    currentPoints = [];
    return obj;
  }

  if (currentRect) {
    currentRect.destroy(); currentRect = null;
    const w = Math.abs(x - startX); const h = Math.abs(y - startY);
    if (w < 4 || h < 4) return null;
    const rx = Math.min(startX, x); const ry = Math.min(startY, y);
    const blurImage = applyBlur(rx, ry, w, h, activeStyle.blurMode ?? "mosaic", intensity);
    if (!blurImage || !layer) return null;
    const id = crypto.randomUUID();
    blurImage.id(id); blurImage.listening(true);
    layer.add(blurImage); layer.batchDraw();
    const obj: AnnotationObject = {
      id, type: "blur", start: { x: rx, y: ry }, end: { x: rx + w, y: ry + h },
      style: { ...activeStyle }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    return obj;
  }
  return null;
}
