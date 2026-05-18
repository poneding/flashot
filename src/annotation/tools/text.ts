import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import {
  resolveTextFontFamily,
  TEXT_LINE_HEIGHT,
  textFontLoadDescriptors,
} from "@/annotation/fonts";
import type { AnnotationObject } from "@/annotation/types";

function redrawWhenFontReady(node: Konva.Text, fontSize: number, fontFamily: string | undefined, text: string) {
  const fonts = document.fonts;
  if (!fonts) return;
  const loads = textFontLoadDescriptors(fontSize, fontFamily, text).map(({ descriptor, text }) => (
    fonts.load(descriptor, text)
  ));
  if (loads.length === 0) return;
  Promise.all(loads).then(() => {
    node.getLayer()?.batchDraw();
  }).catch(() => {
    // Font loading failures fall back to the browser's default font handling.
  });
}

export function renderTextObject(obj: AnnotationObject): Konva.Text {
  const fontSize = obj.style.fontSize ?? 24;
  const text = obj.text ?? "";
  const fontFamily = resolveTextFontFamily(obj.style.fontFamily);
  const node = new Konva.Text({
    id: obj.id,
    x: obj.start!.x + obj.transform.x,
    y: obj.start!.y + obj.transform.y,
    text,
    fontSize,
    fontFamily,
    lineHeight: TEXT_LINE_HEIGHT,
    fill: obj.style.color,
    draggable: true,
    scaleX: obj.transform.scaleX,
    scaleY: obj.transform.scaleY,
    rotation: obj.transform.rotation,
  });
  redrawWhenFontReady(node, fontSize, obj.style.fontFamily, text);
  return node;
}

export function addTextToLayer(obj: AnnotationObject) {
  const layer = getLayer();
  if (!layer) return;
  const node = renderTextObject(obj);
  layer.add(node);
  layer.batchDraw();
}
