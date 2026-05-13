import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import type { AnnotationObject } from "@/annotation/types";

export function renderTextObject(obj: AnnotationObject): Konva.Text {
  return new Konva.Text({
    id: obj.id,
    x: obj.start!.x + obj.transform.x,
    y: obj.start!.y + obj.transform.y,
    text: obj.text ?? "",
    fontSize: obj.style.fontSize ?? 24,
    fontFamily: obj.style.fontFamily ?? "Excalifont",
    fill: obj.style.color,
    scaleX: obj.transform.scaleX,
    scaleY: obj.transform.scaleY,
    rotation: obj.transform.rotation,
  });
}

export function addTextToLayer(obj: AnnotationObject) {
  const layer = getLayer();
  if (!layer) return;
  const node = renderTextObject(obj);
  layer.add(node);
  layer.batchDraw();
}
