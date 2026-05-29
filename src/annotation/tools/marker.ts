import Konva from "konva";
import {
  MARKER_BADGE_TEXT_COLOR,
  MARKER_BUBBLE_BACKGROUND,
  MARKER_BUBBLE_FONT_FAMILY,
  MARKER_BUBBLE_LINE_HEIGHT,
  MARKER_BUBBLE_POINTER_HALF_HEIGHT,
  MARKER_BUBBLE_POINTER_WIDTH,
  MARKER_BUBBLE_RADIUS,
  MARKER_BUBBLE_TEXT_COLOR,
  MARKER_DEFAULT_FONT_SIZE,
  markerBadgeFontSize,
  markerBadgeRadius,
  markerBubbleMetrics,
} from "@/annotation/markerStyle";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";

let startX = 0;
let startY = 0;

function markerFill(style: AnnotationStyle): string {
  return style.markerFill ?? style.color;
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
  const badgeRadius = markerBadgeRadius(obj.style.fontSize);
  const badgeFontSize = markerBadgeFontSize(obj.style.fontSize, markerNumber);
  const bubbleFontSize = obj.style.fontSize ?? MARKER_DEFAULT_FONT_SIZE;
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
    radius: badgeRadius,
    fill: markerFill(obj.style),
    stroke: MARKER_BADGE_TEXT_COLOR,
    strokeWidth: 1.5,
  }));

  group.add(new Konva.Text({
    name: "marker-number",
    x: -badgeRadius,
    y: -badgeRadius + 1,
    width: badgeRadius * 2,
    height: badgeRadius * 2,
    text: String(markerNumber),
    fontSize: badgeFontSize,
    fontStyle: "700",
    align: "center",
    verticalAlign: "middle",
    fill: MARKER_BADGE_TEXT_COLOR,
    listening: false,
  }));

  const bubbleText = (obj.text ?? "").trim();
  if (!bubbleText) return group;
  const metrics = markerBubbleMetrics(bubbleText, bubbleFontSize, badgeRadius);

  const textNode = new Konva.Text({
    name: "marker-bubble-text",
    x: metrics.textX,
    y: metrics.textY,
    width: metrics.textWidth,
    height: metrics.lineHeight,
    text: bubbleText,
    fontSize: bubbleFontSize,
    fontFamily: MARKER_BUBBLE_FONT_FAMILY,
    lineHeight: MARKER_BUBBLE_LINE_HEIGHT,
    fill: MARKER_BUBBLE_TEXT_COLOR,
    listening: false,
  });

  group.add(new Konva.Line({
    name: "marker-bubble-pointer",
    points: [
      metrics.bubbleX,
      -MARKER_BUBBLE_POINTER_HALF_HEIGHT,
      metrics.bubbleX,
      MARKER_BUBBLE_POINTER_HALF_HEIGHT,
      metrics.bubbleX - MARKER_BUBBLE_POINTER_WIDTH,
      0,
    ],
    closed: true,
    fill: MARKER_BUBBLE_BACKGROUND,
    strokeEnabled: false,
    strokeWidth: 0,
    listening: false,
  }));
  group.add(new Konva.Rect({
    name: "marker-bubble",
    x: metrics.bubbleX,
    y: metrics.bubbleY,
    width: metrics.bubbleWidth,
    height: metrics.bubbleHeight,
    fill: MARKER_BUBBLE_BACKGROUND,
    strokeEnabled: false,
    strokeWidth: 0,
    cornerRadius: MARKER_BUBBLE_RADIUS,
  }));
  group.add(textNode);

  return group;
}
