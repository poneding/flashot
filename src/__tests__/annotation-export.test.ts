import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportAnnotationLayer } from "@/annotation/export";
import { useAnnotation } from "@/annotation/store";
import { getStage, getTransformer } from "@/annotation/Stage";
import type Konva from "konva";

vi.mock("@/annotation/Stage", () => ({
  getStage: vi.fn(),
  getTransformer: vi.fn(),
}));

describe("exportAnnotationLayer", () => {
  beforeEach(() => {
    useAnnotation.getState().reset();
    vi.clearAllMocks();
  });

  it("skips PNG export when there are no annotation objects", async () => {
    const toBlob = vi.fn(({ callback }) => callback(null));
    vi.mocked(getStage).mockReturnValue({ toBlob, batchDraw: vi.fn() } as never);
    vi.mocked(getTransformer).mockReturnValue({ visible: vi.fn() } as never);

    await expect(exportAnnotationLayer(2)).resolves.toBeNull();
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("hides edit overlays while exporting annotation PNGs", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const toBlob = vi.fn(({ callback }) => callback(blob));
    const overlay = {
      visible: vi.fn((value?: boolean) => value === undefined ? true : undefined),
    };
    useAnnotation.getState().addObject({
      id: "line-1",
      type: "line",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });
    vi.mocked(getStage).mockReturnValue({
      toBlob,
      batchDraw: vi.fn(),
      find: vi.fn(() => [overlay]),
    } as unknown as Konva.Stage);
    vi.mocked(getTransformer).mockReturnValue({ visible: vi.fn() } as never);

    await exportAnnotationLayer(1);

    expect(overlay.visible).toHaveBeenCalledWith(false);
    expect(overlay.visible).toHaveBeenLastCalledWith(true);
  });
});
