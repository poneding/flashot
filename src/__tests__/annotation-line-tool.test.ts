/** @vitest-environment jsdom */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Konva from "konva";
import { useAnnotation } from "@/annotation/store";
import { onArrowEnd, onArrowMove, onArrowStart } from "@/annotation/tools/arrow";
import { onLineEnd, onLineMove, onLineStart } from "@/annotation/tools/line";

const layer = {
  add: vi.fn(),
  batchDraw: vi.fn(),
};

vi.mock("@/annotation/Stage", () => ({
  getLayer: () => layer,
}));

describe("line drawing tool", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
    } as unknown as CanvasRenderingContext2D);
  });

  beforeEach(() => {
    localStorage.clear();
    layer.add.mockClear();
    layer.batchDraw.mockClear();
    useAnnotation.getState().reset();
    useAnnotation.getState().setActiveStyle({
      color: "#ff0000",
      strokeWidth: 4,
      lineShape: "straight",
      lineStyle: "solid",
    });
  });

  it("normalizes the preview node to the persisted local-coordinate model", () => {
    onLineStart(10, 20);
    onLineMove(110, 80);

    const obj = onLineEnd(110, 80);
    const group = layer.add.mock.calls[0][0] as Konva.Group;
    const mainLine = group.findOne(".main-line") as Konva.Line;

    expect(obj?.start).toEqual({ x: 10, y: 20 });
    expect(group.x()).toBe(10);
    expect(group.y()).toBe(20);
    expect(mainLine.points()).toEqual([0, 0, 100, 60]);
  });

  it("keeps arrow drawing straight after selecting wavy lines", () => {
    useAnnotation.getState().setActiveTool("arrow");
    useAnnotation.getState().setActiveStyle({ lineShape: "wavy", lineStyle: "solid", arrow: "none" });

    onArrowStart(0, 0);
    onArrowMove(120, 0);

    const group = layer.add.mock.calls[0][0] as Konva.Group;
    const previewLine = group.findOne(".main-line") as Konva.Line;
    expect(previewLine.points()).toEqual([0, 0, 120, 0]);

    const obj = onArrowEnd(120, 0);
    const persistedLine = group.findOne(".main-line") as Konva.Line;

    expect(obj?.type).toBe("arrow");
    expect(obj?.style.lineShape).toBe("straight");
    expect(persistedLine.points()).toEqual([0, 0, 120, 0]);
  });

  it("draws wavy lines solid after selecting dashed arrows", () => {
    useAnnotation.getState().setActiveTool("line");
    useAnnotation.getState().setActiveStyle({ lineShape: "wavy", lineStyle: "solid" });

    useAnnotation.getState().setActiveTool("arrow");
    useAnnotation.getState().setActiveStyle({ lineStyle: "dashed" });

    useAnnotation.getState().setActiveTool("line");
    onLineStart(0, 0);
    onLineMove(120, 0);

    const group = layer.add.mock.calls[0][0] as Konva.Group;
    const previewLine = group.findOne(".main-line") as Konva.Line;
    const obj = onLineEnd(120, 0);
    const persistedLine = group.findOne(".main-line") as Konva.Line;

    expect(obj?.style.lineShape).toBe("wavy");
    expect(obj?.style.lineStyle).toBe("solid");
    expect(previewLine.dash() ?? []).toEqual([]);
    expect(persistedLine.dash() ?? []).toEqual([]);
  });
});
