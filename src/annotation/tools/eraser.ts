import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";

let eraserPoints: number[] = [];
let eraserLine: Konva.Line | null = null;

function pathIntersectsRect(points: number[], x: number, y: number, w: number, h: number): boolean {
  for (let i = 0; i < points.length; i += 2) {
    const px = points[i];
    const py = points[i + 1];
    if (px >= x && px <= x + w && py >= y && py <= y + h) return true;
  }
  return false;
}

export function onEraserStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;
  eraserPoints = [x, y];
  const { activeStyle } = useAnnotation.getState();
  eraserLine = new Konva.Line({
    points: eraserPoints, stroke: "rgba(255,255,255,0.5)",
    strokeWidth: activeStyle.strokeWidth * 4, lineCap: "round",
    lineJoin: "round", dash: [4, 4], listening: false,
  });
  layer.add(eraserLine);
}

export function onEraserMove(x: number, y: number) {
  if (!eraserLine) return;
  eraserPoints.push(x, y);
  eraserLine.points([...eraserPoints]);
  getLayer()?.batchDraw();
}

export function onEraserEnd() {
  if (!eraserLine) return;
  eraserLine.destroy();
  eraserLine = null;
  const { objects, deleteObject } = useAnnotation.getState();
  const layer = getLayer();
  if (!layer) return;
  const toDelete: string[] = [];
  for (const obj of objects) {
    const node = layer.findOne(`#${obj.id}`);
    if (!node) continue;
    const box = node.getClientRect();
    if (pathIntersectsRect(eraserPoints, box.x, box.y, box.width, box.height)) {
      toDelete.push(obj.id);
    }
  }
  for (const id of toDelete) {
    const node = layer.findOne(`#${id}`);
    node?.destroy();
    deleteObject(id);
  }
  eraserPoints = [];
  layer.batchDraw();
}
