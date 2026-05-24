/** @vitest-environment jsdom */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Konva from "konva";
import { useAnnotation } from "@/annotation/store";
import {
  measureLabel,
  measureLength,
  onMeasureEnd,
  onMeasureMove,
  onMeasureStart,
  renderMeasureObject,
} from "@/annotation/tools/measure";

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
    expect(measureLabel({ x: 10, y: 20 }, { x: 110, y: 20 })).toBe("100 px");
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
    expect(label.text()).toBe("5 px");
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
    const ticks = node.find(".measure-tick");

    expect(node.x()).toBe(15);
    expect(node.y()).toBe(27);
    expect(label.text()).toBe("100 px");
    expect(ticks).toHaveLength(2);
  });
});
