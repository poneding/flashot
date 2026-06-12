import Konva from "konva";
import {
  MARKER_BADGE_TEXT_COLOR,
  MARKER_BUBBLE_BACKGROUND,
  MARKER_BUBBLE_FONT_FAMILY,
  MARKER_BUBBLE_LINE_HEIGHT,
  MARKER_BUBBLE_PADDING_X,
  MARKER_BUBBLE_PADDING_Y,
  MARKER_BUBBLE_RADIUS,
  MARKER_BUBBLE_TEXT_COLOR,
  MARKER_DEFAULT_FONT_SIZE,
  defaultMarkerLabelAnchor,
  markerBadgeFontSize,
  markerBadgeRadius,
  markerBadgeVisualRadius,
  markerLabelMetrics,
} from "@/annotation/markerStyle";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";
import type { Point } from "@/lib/types";

const MARKER_CONNECTOR_BADGE_CLEARANCE = 2;
const MARKER_GLOW_BLUR = 10;
const MARKER_GLOW_OPACITY = 0.85;

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

export function markerLabelAnchor(obj: AnnotationObject): Point {
  return obj.end ?? defaultMarkerLabelAnchor(obj.start ?? { x: 0, y: 0 }, obj.text ?? "", obj.style.fontSize);
}

export function markerConnectorPoints(
  badgeCenter: Point,
  badgeRadius: number,
  labelBox: { x: number; y: number; width: number; height: number },
): number[] | null {
  const cx = Math.max(labelBox.x, Math.min(badgeCenter.x, labelBox.x + labelBox.width));
  const cy = Math.max(labelBox.y, Math.min(badgeCenter.y, labelBox.y + labelBox.height));
  const dx = cx - badgeCenter.x;
  const dy = cy - badgeCenter.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= badgeRadius + MARKER_CONNECTOR_BADGE_CLEARANCE) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  return [badgeCenter.x + ux * badgeRadius, badgeCenter.y + uy * badgeRadius, cx, cy];
}

export function updateMarkerObjectNode(group: Konva.Group, obj: AnnotationObject): void {
  const connector = group.findOne(".marker-connector") as Konva.Line | undefined;
  const badgePart = group.findOne(".marker-badge-part") as Konva.Group | undefined;
  const labelPart = group.findOne(".marker-label-part") as Konva.Group | undefined;
  if (!connector || !badgePart || !labelPart) return;

  const badge = badgePart.findOne(".marker-badge") as Konva.Circle | undefined;
  const box = labelPart.findOne(".marker-label-box") as Konva.Rect | undefined;
  const metrics = markerLabelMetrics((obj.text ?? "").trim(), obj.style.fontSize);
  const points = markerConnectorPoints(
    { x: badgePart.x(), y: badgePart.y() },
    badge?.radius() ?? markerBadgeVisualRadius(obj.style.fontSize),
    {
      x: labelPart.x(),
      y: labelPart.y(),
      width: box?.width() ?? metrics.width,
      height: box?.height() ?? metrics.height,
    },
  );

  if (!points) {
    connector.visible(false);
    return;
  }
  connector.points(points);
  connector.visible(true);
}

export function renderMarkerObject(obj: AnnotationObject): Konva.Group {
  const start = obj.start ?? { x: 0, y: 0 };
  const transform = obj.transform;
  const markerNumber = obj.markerNumber ?? 1;
  const fill = markerFill(obj.style);
  const badgeRadius = markerBadgeVisualRadius(obj.style.fontSize);
  const badgeLayoutRadius = markerBadgeRadius(obj.style.fontSize);
  const badgeFontSize = markerBadgeFontSize(obj.style.fontSize, markerNumber);
  const labelFontSize = obj.style.fontSize ?? MARKER_DEFAULT_FONT_SIZE;
  // The outer group carries only the transform offset; the badge and label
  // parts carry absolute stage positions so independent part drags read cleanly.
  const group = new Konva.Group({
    id: obj.id,
    x: transform.x,
    y: transform.y,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
    draggable: false,
  });

  const badgePart = new Konva.Group({
    name: "marker-badge-part",
    x: start.x,
    y: start.y,
    draggable: true,
  });
  badgePart.add(new Konva.Circle({
    name: "marker-badge",
    x: 0,
    y: 0,
    radius: badgeRadius,
    fill,
    stroke: MARKER_BADGE_TEXT_COLOR,
    strokeWidth: 1.5,
  }));
  badgePart.add(new Konva.Text({
    name: "marker-number",
    x: -badgeLayoutRadius,
    y: -badgeLayoutRadius,
    width: badgeLayoutRadius * 2,
    height: badgeLayoutRadius * 2,
    text: String(markerNumber),
    fontSize: badgeFontSize,
    fontStyle: "700",
    align: "center",
    verticalAlign: "middle",
    fill: MARKER_BADGE_TEXT_COLOR,
    listening: false,
  }));

  const labelText = (obj.text ?? "").trim();
  if (!labelText) {
    group.add(badgePart);
    return group;
  }

  const anchor = markerLabelAnchor(obj);
  const metrics = markerLabelMetrics(labelText, labelFontSize);

  const connector = new Konva.Line({
    name: "marker-connector",
    points: [0, 0, 0, 0],
    stroke: fill,
    strokeWidth: 1.5,
    dash: [4, 3],
    opacity: 0.9,
    listening: false,
  });

  const labelPart = new Konva.Group({
    name: "marker-label-part",
    x: anchor.x,
    y: anchor.y,
    draggable: true,
  });
  labelPart.add(new Konva.Rect({
    name: "marker-label-box",
    x: 0,
    y: 0,
    width: metrics.width,
    height: metrics.height,
    fill: MARKER_BUBBLE_BACKGROUND,
    cornerRadius: MARKER_BUBBLE_RADIUS,
    stroke: fill,
    strokeWidth: 1.5,
    shadowColor: fill,
    shadowBlur: MARKER_GLOW_BLUR,
    shadowOpacity: MARKER_GLOW_OPACITY,
  }));
  labelPart.add(new Konva.Text({
    name: "marker-label-text",
    x: MARKER_BUBBLE_PADDING_X,
    y: MARKER_BUBBLE_PADDING_Y,
    width: metrics.width - MARKER_BUBBLE_PADDING_X * 2,
    height: metrics.lineHeight,
    text: labelText,
    fontSize: labelFontSize,
    fontFamily: MARKER_BUBBLE_FONT_FAMILY,
    lineHeight: MARKER_BUBBLE_LINE_HEIGHT,
    fill: MARKER_BUBBLE_TEXT_COLOR,
    listening: false,
  }));

  group.add(connector);
  group.add(badgePart);
  group.add(labelPart);
  updateMarkerObjectNode(group, obj);

  return group;
}
