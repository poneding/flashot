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
  MARKER_GLOW_BLUR,
  MARKER_LABEL_STROKE_WIDTH,
  markerBadgeFontSize,
  markerBadgeRadius,
  markerBadgeVisualRadius,
  markerLabelAnchor,
  markerLabelMetrics,
} from "@/annotation/markerStyle";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";
import type { Point } from "@/lib/types";

const MARKER_CONNECTOR_BADGE_CLEARANCE = 2;
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

export function markerConnectorPoints(
  badgeCenter: Point,
  badgeRadius: number,
  labelBox: { x: number; y: number; width: number; height: number },
): number[] | null {
  // For each edge, compute clamped point:
  const edges = [
    { x: labelBox.x + labelBox.width / 2, y: labelBox.y },           // top mid
    { x: labelBox.x + labelBox.width / 2, y: labelBox.y + labelBox.height }, // bottom mid
    { x: labelBox.x, y: labelBox.y + labelBox.height / 2 },          // left mid
    { x: labelBox.x + labelBox.width, y: labelBox.y + labelBox.height / 2 }, // right mid
  ];
  // Pick the edge point nearest to badgeCenter
  const closest = edges.reduce((best, pt) => {
    const d = Math.hypot(pt.x - badgeCenter.x, pt.y - badgeCenter.y);
    return d < best.dist ? { pt, dist: d } : best;
  }, { pt: edges[0], dist: Infinity }).pt;
  const cx = closest.x, cy = closest.y;
  const dx = cx - badgeCenter.x;
  const dy = cy - badgeCenter.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= badgeRadius + MARKER_CONNECTOR_BADGE_CLEARANCE) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  return [badgeCenter.x + ux * badgeRadius, badgeCenter.y + uy * badgeRadius, cx, cy];
}

export function markerPartFromTarget(node: Konva.Node | null): "badge" | "label" | null {
  let current: Konva.Node | null = node;
  while (current) {
    if (current.hasName("marker-badge-part")) return "badge";
    if (current.hasName("marker-label-part")) return "label";
    current = current.getParent();
  }
  return null;
}

export function markerPartDragUpdates(obj: AnnotationObject, group: Konva.Group): Partial<AnnotationObject> {
  const badgePart = group.findOne(".marker-badge-part") as Konva.Group | undefined;
  const labelPart = group.findOne(".marker-label-part") as Konva.Group | undefined;
  const t = obj.transform;
  // Bake the transform offset into both anchors so zeroing it never moves a part.
  const start = badgePart
    ? { x: t.x + badgePart.x(), y: t.y + badgePart.y() }
    : obj.start;
  const end = labelPart
    ? { x: t.x + labelPart.x(), y: t.y + labelPart.y() }
    : (obj.end ? { x: t.x + obj.end.x, y: t.y + obj.end.y } : undefined);

  return { start, end, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } };
}

export function updateMarkerObjectNode(group: Konva.Group): void {
  const connector = group.findOne(".marker-connector") as Konva.Line | undefined;
  const badgePart = group.findOne(".marker-badge-part") as Konva.Group | undefined;
  const labelPart = group.findOne(".marker-label-part") as Konva.Group | undefined;
  if (!connector || !badgePart || !labelPart) return;

  const badge = badgePart.findOne(".marker-badge") as Konva.Circle | undefined;
  const box = labelPart.findOne(".marker-label-box") as Konva.Rect | undefined;
  if (!badge || !box) return;

  const points = markerConnectorPoints(
    { x: badgePart.x(), y: badgePart.y() },
    badge.radius(),
    {
      x: labelPart.x(),
      y: labelPart.y(),
      width: box.width(),
      height: box.height(),
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
  const connectorStyle = obj.style.markerConnectorStyle ?? "dashed";
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
    dash: connectorStyle === "solid" ? [] : [4, 3],
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
    strokeWidth: MARKER_LABEL_STROKE_WIDTH,
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
  updateMarkerObjectNode(group);

  return group;
}
