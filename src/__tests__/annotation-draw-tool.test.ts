/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Konva from "konva";
import { useAnnotation } from "@/annotation/store";
import { onDrawEnd, onDrawMove, onDrawStart, renderDrawObject } from "@/annotation/tools/draw";

const layer = {
  add: vi.fn(),
  batchDraw: vi.fn(),
};

vi.mock("@/annotation/Stage", () => ({
  getLayer: () => layer,
}));

describe("draw tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
    } as unknown as CanvasRenderingContext2D);
    layer.add.mockClear();
    layer.batchDraw.mockClear();
    useAnnotation.getState().reset();
    useAnnotation.getState().setActiveTool("draw");
    useAnnotation.getState().setActiveStyle({ color: "#ff0000", strokeWidth: 4 });
  });

  it("renders hand-drawn strokes with smoothing", () => {
    onDrawStart(0, 0);
    onDrawMove(20, 10);

    const previewPath = layer.add.mock.calls[0][0] as Konva.Path;
    const obj = onDrawEnd();
    const renderedPath = renderDrawObject(obj!);

    expect(previewPath).toBeInstanceOf(Konva.Path);
    expect(renderedPath).toBeInstanceOf(Konva.Path);
    expect(previewPath.data()).toContain("Q");
    expect(renderedPath.data()).toBe(previewPath.data());
    expect(renderedPath.fill()).toBe("#ff0000");
    expect(renderedPath.strokeEnabled()).toBe(false);
  });

  it("coalesces pen preview redraws to animation frames while keeping the final stroke current", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    onDrawStart(0, 0);
    onDrawMove(12, 4);
    onDrawMove(24, 0);

    const previewPath = layer.add.mock.calls[0][0] as Konva.Path;
    expect(layer.batchDraw).not.toHaveBeenCalled();

    expect(frames).toHaveLength(1);
    frames[0](16);
    const framedData = previewPath.data();
    expect(framedData).toContain("Q");
    expect(layer.batchDraw).toHaveBeenCalledTimes(1);

    onDrawMove(36, 10);
    const obj = onDrawEnd();

    expect(obj?.points).toEqual([0, 0, 12, 4, 24, 0, 36, 10]);
    expect(previewPath.data()).not.toBe(framedData);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it("filters subpixel pointer jitter from hand-drawn strokes", () => {
    onDrawStart(0, 0);
    onDrawMove(0.2, 0.2);
    onDrawMove(1, 0);

    const obj = onDrawEnd();

    expect(obj?.points).toEqual([0, 0, 1, 0]);
  });

  it("keeps the raw pointer path while rendering a smoothed stroke outline", () => {
    onDrawStart(0, 0);
    onDrawMove(12, 4);
    onDrawMove(24, 0);
    onDrawMove(36, 10);

    const previewPath = layer.add.mock.calls[0][0] as Konva.Path;
    const obj = onDrawEnd();

    expect(obj?.points).toEqual([0, 0, 12, 4, 24, 0, 36, 10]);
    expect(previewPath.data().startsWith("M")).toBe(true);
    expect(previewPath.data()).toContain("T");
    expect(previewPath.data().endsWith("Z")).toBe(true);
  });
});
