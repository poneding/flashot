import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";
import { canvasRGBA } from "stackblur-canvas";

let startX = 0;
let startY = 0;
let currentRect: Konva.Rect | null = null;

export function blurSampleRectForObject(obj: AnnotationObject): { x: number; y: number; width: number; height: number } {
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? { x: 0, y: 0 };
  const transform = obj.transform;
  const baseX = Math.min(start.x, end.x) + transform.x;
  const baseY = Math.min(start.y, end.y) + transform.y;
  const baseWidth = Math.abs(end.x - start.x);
  const baseHeight = Math.abs(end.y - start.y);
  const width = baseWidth * Math.abs(transform.scaleX);
  const height = baseHeight * Math.abs(transform.scaleY);

  return {
    x: transform.scaleX < 0 ? baseX - width : baseX,
    y: transform.scaleY < 0 ? baseY - height : baseY,
    width,
    height,
  };
}

export function blurResizeUpdatesFromNode(node: Konva.Node): Partial<AnnotationObject> {
  const shape = node as Konva.Shape;
  const width = Math.max(1, shape.width() * Math.abs(node.scaleX()));
  const height = Math.max(1, shape.height() * Math.abs(node.scaleY()));
  const x = node.scaleX() < 0 ? node.x() - width : node.x();
  const y = node.scaleY() < 0 ? node.y() - height : node.y();

  return {
    start: { x, y },
    end: { x: x + width, y: y + height },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

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
  if (!bgImg || !bgImg.naturalWidth) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // The frozen layer image covers the full monitor. The annotation stage
  // coordinates are relative to the selection rect. We need to map stage-local
  // coords to the image's natural pixel coords.
  const scaleX = bgImg.naturalWidth / bgImg.clientWidth;
  const scaleY = bgImg.naturalHeight / bgImg.clientHeight;

  // Get selection offset — the annotation stage is positioned at selection.x/y
  const stageEl = document.querySelector("[data-annotation-stage]") as HTMLElement | null;
  const offsetX = stageEl ? parseFloat(stageEl.style.left || "0") : 0;
  const offsetY = stageEl ? parseFloat(stageEl.style.top || "0") : 0;

  const sx = (x + offsetX) * scaleX;
  const sy = (y + offsetY) * scaleY;
  const sw = w * scaleX;
  const sh = h * scaleY;

  try {
    ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, Math.round(w), Math.round(h));
    return ctx.getImageData(0, 0, Math.round(w), Math.round(h));
  } catch {
    return null;
  }
}

function applyBlur(
  x: number,
  y: number,
  w: number,
  h: number,
  mode: "mosaic" | "gaussian" | "solid",
  intensity: number,
  solidColor?: string
): Konva.Image | Konva.Rect | null {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(w);
  const rh = Math.round(h);

  // For solid mode, use Konva.Rect for better performance
  if (mode === "solid") {
    const color = solidColor ?? "#000000";
    return new Konva.Rect({
      x: rx, y: ry, width: rw, height: rh,
      fill: color,
    });
  }

  // For mosaic and gaussian, process the image
  const imageData = getBackgroundImageData(rx, ry, rw, rh);
  if (!imageData) return null;

  let processed: ImageData;
  if (mode === "mosaic") {
    processed = pixelate(imageData, intensity);
  } else {
    // gaussian mode - use StackBlur
    processed = stackBlur(imageData, intensity);
  }

  const canvas = document.createElement("canvas");
  canvas.width = rw;
  canvas.height = rh;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(processed, 0, 0);
  return new Konva.Image({ x: rx, y: ry, width: rw, height: rh, image: canvas });
}

function stackBlur(imageData: ImageData, radius: number): ImageData {
  const { width, height } = imageData;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);

  // Use StackBlur library - much faster than custom implementation
  canvasRGBA(canvas, 0, 0, width, height, radius);

  return ctx.getImageData(0, 0, width, height);
}

export function onBlurStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;
  startX = x; startY = y;

  currentRect = new Konva.Rect({
    x, y, width: 0, height: 0, stroke: "rgba(100,100,255,0.5)",
    strokeWidth: 1, dash: [4, 4], listening: false,
  });
  layer.add(currentRect);
}

export function onBlurMove(x: number, y: number) {
  if (currentRect) {
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
  const mode = activeStyle.blurMode ?? "mosaic";
  const solidColor = activeStyle.blurSolidColor;

  if (currentRect) {
    currentRect.destroy(); currentRect = null;
    const w = Math.abs(x - startX); const h = Math.abs(y - startY);
    if (w < 4 || h < 4) return null;
    const rx = Math.min(startX, x); const ry = Math.min(startY, y);
    const blurNode = applyBlur(rx, ry, w, h, mode, intensity, solidColor);
    if (!blurNode || !layer) return null;
    const id = crypto.randomUUID();
    blurNode.id(id); blurNode.listening(true); blurNode.draggable(true);
    layer.add(blurNode); layer.batchDraw();
    const obj: AnnotationObject = {
      id, type: "blur", start: { x: rx, y: ry }, end: { x: rx + w, y: ry + h },
      style: { ...activeStyle }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    return obj;
  }
  return null;
}

export function renderBlurObject(obj: AnnotationObject): Konva.Image | Konva.Rect | null {
  const rect = blurSampleRectForObject(obj);
  if (rect.width < 1 || rect.height < 1) return null;
  const mode = obj.style.blurMode ?? "mosaic";
  const intensity = obj.style.blurIntensity ?? 10;
  const solidColor = obj.style.blurSolidColor;
  const node = applyBlur(rect.x, rect.y, rect.width, rect.height, mode, intensity, solidColor);
  if (!node) return null;
  node.id(obj.id);
  node.scaleX(1);
  node.scaleY(1);
  node.rotation(0);
  node.listening(true);
  node.draggable(true);
  return node;
}

export function refreshBlurObjectNode(node: Konva.Node, obj: AnnotationObject): boolean {
  const rect = blurSampleRectForObject(obj);
  const mode = obj.style.blurMode ?? "mosaic";
  const intensity = obj.style.blurIntensity ?? 10;
  const solidColor = obj.style.blurSolidColor;

  if (mode === "solid" && node instanceof Konva.Rect) {
    node.setAttrs({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      fill: solidColor ?? "#000000",
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    });
    return true;
  }

  if (!(node instanceof Konva.Image)) return false;
  const nextNode = applyBlur(rect.x, rect.y, rect.width, rect.height, mode, intensity, solidColor);
  if (!(nextNode instanceof Konva.Image)) return false;

  node.setAttrs({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    image: nextNode.image(),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  });
  return true;
}
