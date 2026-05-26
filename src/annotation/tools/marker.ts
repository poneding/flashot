import Konva from "konva";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";

const BADGE_RADIUS = 12;
const BUBBLE_GAP = 8;
const BUBBLE_PADDING_X = 8;
const BUBBLE_PADDING_Y = 5;
const BUBBLE_FONT_SIZE = 14;

let startX = 0;
let startY = 0;

function markerFill(style: AnnotationStyle): string {
  return style.markerFill ?? style.color;
}

function markerTextColor(style: AnnotationStyle): string {
  return style.markerTextColor ?? "#ffffff";
}

function markerBubbleFill(style: AnnotationStyle): string {
  return style.markerBubbleFill ?? "#111827";
}

export function onMarkerStart(x: number, y: number) {
  startX = x;
  startY = y;
}

export function onMarkerMove(_x: number, _y: number) {
  // Marker placement is click-based; movement is handled after creation.
}

export function onMarkerEnd(): AnnotationObject {
  const { activeStyle, allocateMarkerNumber } = useAnnotation.getState();

  return {
    id: crypto.randomUUID(),
    type: "marker",
    start: { x: startX, y: startY },
    markerNumber: allocateMarkerNumber(),
    text: "",
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

export function renderMarkerObject(obj: AnnotationObject): Konva.Group {
  const start = obj.start ?? { x: 0, y: 0 };
  const transform = obj.transform;
  const markerNumber = obj.markerNumber ?? 1;
  const group = new Konva.Group({
    id: obj.id,
    x: start.x + transform.x,
    y: start.y + transform.y,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
    draggable: true,
  });

  group.add(new Konva.Circle({
    name: "marker-badge",
    x: 0,
    y: 0,
    radius: BADGE_RADIUS,
    fill: markerFill(obj.style),
    stroke: markerTextColor(obj.style),
    strokeWidth: 1.5,
  }));

  group.add(new Konva.Text({
    name: "marker-number",
    x: -BADGE_RADIUS,
    y: -BADGE_RADIUS + 1,
    width: BADGE_RADIUS * 2,
    height: BADGE_RADIUS * 2,
    text: String(markerNumber),
    fontSize: 13,
    fontStyle: "700",
    align: "center",
    verticalAlign: "middle",
    fill: markerTextColor(obj.style),
    listening: false,
  }));

  const bubbleText = (obj.text ?? "").trim();
  if (!bubbleText) return group;

  const textNode = new Konva.Text({
    name: "marker-bubble-text",
    x: BADGE_RADIUS + BUBBLE_GAP + BUBBLE_PADDING_X,
    y: -BADGE_RADIUS + BUBBLE_PADDING_Y - 1,
    text: bubbleText,
    fontSize: BUBBLE_FONT_SIZE,
    fill: markerTextColor(obj.style),
    listening: false,
  });
  const bubbleWidth = Math.max(36, textNode.width() + BUBBLE_PADDING_X * 2);
  const bubbleHeight = Math.max(BADGE_RADIUS * 2, textNode.height() + BUBBLE_PADDING_Y * 2);

  group.add(new Konva.Rect({
    name: "marker-bubble",
    x: BADGE_RADIUS + BUBBLE_GAP,
    y: -bubbleHeight / 2,
    width: bubbleWidth,
    height: bubbleHeight,
    fill: markerBubbleFill(obj.style),
    cornerRadius: 7,
  }));
  group.add(textNode);

  return group;
}
