import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";
import type { Point } from "@/lib/types";

let currentGroup: Konva.Group | null = null;
let startX = 0;
let startY = 0;

const MIN_MEASURE_DISTANCE = 4;
const LABEL_FONT_SIZE = 12;
const LABEL_HEIGHT = 20;
const LABEL_PADDING_X = 7;
const LABEL_MIN_WIDTH = 38;
const LABEL_OFFSET = 18;
const LABEL_BACKGROUND_FILL = "#111827";
const LABEL_TEXT_FILL = "#ffffff";
const LABEL_BORDER_WIDTH = 1;

export function measureLength(start: Point, end: Point): number {
  return Math.round(Math.hypot(end.x - start.x, end.y - start.y));
}

export function measureLabel(start: Point, end: Point): string {
  return `${measureLength(start, end)} px`;
}

function estimateLabelWidth(text: string): number {
  return Math.max(LABEL_MIN_WIDTH, Math.ceil(text.length * LABEL_FONT_SIZE * 0.58) + LABEL_PADDING_X * 2);
}

function unitVector(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

function perpendicularUnit(dx: number, dy: number): Point {
  const unit = unitVector(dx, dy);
  return { x: -unit.y, y: unit.x };
}

function tickPoints(x: number, y: number, normal: Point, halfLength: number): number[] {
  return [
    x - normal.x * halfLength,
    y - normal.y * halfLength,
    x + normal.x * halfLength,
    y + normal.y * halfLength,
  ];
}

function labelRotation(dx: number, dy: number): number {
  let degrees = Math.atan2(dy, dx) * 180 / Math.PI;
  if (degrees > 90) degrees -= 180;
  if (degrees < -90) degrees += 180;
  return degrees;
}

function buildMeasureObjectChildren(group: Konva.Group, obj: AnnotationObject) {
  group.destroyChildren();

  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? start;
  const style = obj.style;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const normal = perpendicularUnit(dx, dy);
  const tickHalfLength = Math.max(6, style.strokeWidth * 1.6);
  const label = measureLabel(start, end);
  const labelWidth = estimateLabelWidth(label);
  const labelOffset = Math.max(LABEL_OFFSET, style.strokeWidth * 2 + 10);
  const labelCenterX = dx / 2 + normal.x * labelOffset;
  const labelCenterY = dy / 2 + normal.y * labelOffset;

  group.add(new Konva.Line({
    points: [0, 0, dx, dy],
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    lineJoin: "round",
    name: "measure-main-line",
  }));

  group.add(new Konva.Line({
    points: tickPoints(0, 0, normal, tickHalfLength),
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    name: "measure-tick",
  }));

  group.add(new Konva.Line({
    points: tickPoints(dx, dy, normal, tickHalfLength),
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    name: "measure-tick",
  }));

  const labelGroup = new Konva.Group({
    x: labelCenterX,
    y: labelCenterY,
    rotation: labelRotation(dx, dy),
    name: "measure-label-group",
  });

  labelGroup.add(new Konva.Rect({
    x: -labelWidth / 2,
    y: -LABEL_HEIGHT / 2,
    width: labelWidth,
    height: LABEL_HEIGHT,
    cornerRadius: 5,
    fill: LABEL_BACKGROUND_FILL,
    stroke: style.color,
    strokeWidth: LABEL_BORDER_WIDTH,
    name: "measure-label-bg",
  }));

  labelGroup.add(new Konva.Text({
    x: -labelWidth / 2,
    y: -LABEL_HEIGHT / 2 + 3,
    width: labelWidth,
    height: LABEL_HEIGHT,
    text: label,
    fill: LABEL_TEXT_FILL,
    fontFamily: "system-ui",
    fontSize: LABEL_FONT_SIZE,
    fontStyle: "bold",
    align: "center",
    listening: false,
    name: "measure-label",
  }));

  group.add(labelGroup);
}

function makeMeasureObject(x: number, y: number, style: AnnotationStyle, id: string = crypto.randomUUID()): AnnotationObject {
  return {
    id,
    type: "measure",
    start: { x: startX, y: startY },
    end: { x, y },
    style: {
      ...style,
      lineShape: "straight",
      lineStyle: "solid",
      arrow: "none",
    },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

export function onMeasureStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  startX = x;
  startY = y;
  currentGroup = new Konva.Group({ listening: false, x, y });
  const obj = makeMeasureObject(x, y, useAnnotation.getState().activeStyle, "measure-preview");
  buildMeasureObjectChildren(currentGroup, obj);
  layer.add(currentGroup);
}

export function onMeasureMove(x: number, y: number) {
  if (!currentGroup) return;
  const obj = makeMeasureObject(x, y, useAnnotation.getState().activeStyle, "measure-preview");
  buildMeasureObjectChildren(currentGroup, obj);
  getLayer()?.batchDraw();
}

export function onMeasureEnd(x: number, y: number): AnnotationObject | null {
  if (!currentGroup || Math.hypot(x - startX, y - startY) < MIN_MEASURE_DISTANCE) {
    currentGroup?.destroy();
    currentGroup = null;
    return null;
  }

  const obj = makeMeasureObject(x, y, useAnnotation.getState().activeStyle);
  currentGroup.id(obj.id);
  currentGroup.listening(true);
  currentGroup.draggable(false);
  currentGroup.position({ x: obj.start!.x, y: obj.start!.y });
  buildMeasureObjectChildren(currentGroup, obj);
  currentGroup = null;
  return obj;
}

export function updateMeasureObjectNode(group: Konva.Group, obj: AnnotationObject) {
  buildMeasureObjectChildren(group, obj);
}

export function renderMeasureObject(obj: AnnotationObject): Konva.Group {
  const transform = obj.transform;
  const start = obj.start ?? { x: 0, y: 0 };
  const group = new Konva.Group({
    id: obj.id,
    draggable: false,
    x: start.x + transform.x,
    y: start.y + transform.y,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
  });

  buildMeasureObjectChildren(group, obj);
  return group;
}
