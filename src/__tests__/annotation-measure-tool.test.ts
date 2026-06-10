/** @vitest-environment jsdom */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Konva from "konva";
import { useAnnotation } from "@/annotation/store";
import {
  constrainMeasureEndpoint,
  constrainMeasureObjectToAxisAroundMidpoint,
  measureLabel,
  measureLength,
  onMeasureEnd,
  onMeasureMove,
  onMeasureStart,
  renderMeasureObject,
} from "@/annotation/tools/measure";
import type { AnnotationObject } from "@/annotation/types";

const layer = {
  add: vi.fn(),
  batchDraw: vi.fn(),
};

vi.mock("@/annotation/Stage", () => ({
  getLayer: () => layer,
}));

describe("measure annotation tool", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
      measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    } as unknown as CanvasRenderingContext2D);
  });

  beforeEach(() => {
    layer.add.mockClear();
    layer.batchDraw.mockClear();
    useAnnotation.getState().reset();
    useAnnotation.getState().setActiveTool("measure");
    useAnnotation.getState().setActiveStyle({ color: "#ff0000", strokeWidth: 4 });
  });

  it("computes logical pixel distance labels", () => {
    expect(measureLength({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(measureLabel({ x: 10, y: 20 }, { x: 110, y: 20 })).toBe("100px");
  });

  it("constrains axis measurements to the dominant horizontal or vertical direction", () => {
    expect(constrainMeasureEndpoint({ x: 10, y: 20 }, { x: 70, y: 45 }, "axis")).toEqual({ x: 70, y: 20 });
    expect(constrainMeasureEndpoint({ x: 10, y: 20 }, { x: 35, y: 90 }, "axis")).toEqual({ x: 10, y: 90 });
    expect(constrainMeasureEndpoint({ x: 10, y: 20 }, { x: 35, y: 90 }, "free")).toEqual({ x: 35, y: 90 });
  });

  it("rebuilds an existing measurement around its midpoint when axis mode is applied", () => {
    const measure: AnnotationObject = {
      id: "measure-1",
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      style: { color: "#ff0000", strokeWidth: 4, measureMode: "free" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    const next = constrainMeasureObjectToAxisAroundMidpoint(measure);

    expect(next.start?.x).toBeCloseTo(15);
    expect(next.start?.y).toBeCloseTo(-5);
    expect(next.end?.x).toBeCloseTo(15);
    expect(next.end?.y).toBeCloseTo(45);
    expect(measureLength(next.start!, next.end!)).toBe(50);
  });

  it("creates a measure object with a live label", () => {
    onMeasureStart(10, 20);
    onMeasureMove(13, 24);

    const obj = onMeasureEnd(13, 24);
    const group = layer.add.mock.calls[0][0] as Konva.Group;
    const mainLine = group.findOne(".measure-main-line") as Konva.Line;
    const label = group.findOne(".measure-label") as Konva.Text;

    expect(obj?.type).toBe("measure");
    expect(obj?.start).toEqual({ x: 10, y: 20 });
    expect(obj?.end).toEqual({ x: 13, y: 24 });
    expect(group.x()).toBe(10);
    expect(group.y()).toBe(20);
    expect(mainLine.points()).toEqual([0, 0, 3, 4]);
    expect(label.text()).toBe("5px");
  });

  it("creates an axis-constrained measure object when axis mode is active", () => {
    useAnnotation.getState().setActiveStyle({ measureMode: "axis" });

    onMeasureStart(10, 20);
    onMeasureMove(70, 45);

    const obj = onMeasureEnd(70, 45);
    const group = layer.add.mock.calls[0][0] as Konva.Group;
    const mainLine = group.findOne(".measure-main-line") as Konva.Line;

    expect(obj?.end).toEqual({ x: 70, y: 20 });
    expect(mainLine.points()).toEqual([0, 0, 60, 0]);
  });

  it("discards tiny measure drags", () => {
    onMeasureStart(10, 20);

    expect(onMeasureEnd(12, 22)).toBeNull();
  });

  it("renders a committed measurement from stored points", () => {
    const node = renderMeasureObject({
      id: "measure-1",
      type: "measure",
      start: { x: 10, y: 20 },
      end: { x: 110, y: 20 },
      style: { color: "#0099ff", strokeWidth: 6 },
      transform: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    const label = node.findOne(".measure-label") as Konva.Text;
    const labelGroup = node.findOne(".measure-label-group") as Konva.Group;
    const labelBg = node.findOne(".measure-label-bg") as Konva.Rect;
    const mainLine = node.findOne(".measure-main-line") as Konva.Line;
    const ticks = node.find(".measure-tick");

    expect(node.draggable()).toBe(true);
    expect(node.x()).toBe(15);
    expect(node.y()).toBe(27);
    expect(label.text()).toBe("100px");
    expect(label.fill()).toBe("#ffffff");
    expect(label.fontStyle()).not.toBe("bold");
    expect(labelBg.fill()).toBe("#111827");
    expect(labelBg.strokeEnabled()).toBe(false);
    expect(labelBg.strokeWidth()).toBe(0);
    expect(labelBg.listening()).toBe(true);
    expect(mainLine.listening()).toBe(false);
    expect(labelGroup.rotation()).toBe(0);
    expect(ticks).toHaveLength(2);
  });

  it("keeps the measurement label parallel to the measured line", () => {
    const node = renderMeasureObject({
      id: "measure-1",
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      style: { color: "#0099ff", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    const labelGroup = node.findOne(".measure-label-group") as Konva.Group;

    expect(labelGroup.rotation()).toBeCloseTo(53.13, 2);
  });
});
