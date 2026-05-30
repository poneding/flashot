/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Konva from "konva";
import * as StageModule from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";
import { hitTestHandle, rectContainsPoint } from "@/lib/geometry";
import type { CaptureStartPayload } from "@/lib/types";
import { useOverlay } from "@/overlay/state";

const { AnnotationStage, getLayer, getTransformer } = StageModule;

vi.mock("@/lib/ipc", () => ({
  beginTextInputSession: vi.fn().mockResolvedValue(undefined),
  endTextInputSession: vi.fn().mockResolvedValue(undefined),
}));

const selection = { x: 100, y: 120, width: 240, height: 160 };
const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost/frame.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
  cornerRadius: 0,
};

const annotatedRect: AnnotationObject = {
  id: "rect-1",
  type: "rect",
  start: { x: 20, y: 24 },
  end: { x: 100, y: 80 },
  style: { color: "#ff0000", strokeWidth: 4 },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
};


function installImageMock() {
  class MockImage {
    width = 640;
    height = 360;
    crossOrigin = "";
    onload: null | (() => void) = null;
    onerror: null | ((error: unknown) => void) = null;
    private value = "";

    set src(next: string) {
      this.value = next;
      setTimeout(() => this.onload?.(), 0);
    }

    get src() {
      return this.value;
    }
  }

  vi.stubGlobal("Image", MockImage);
}

function MoveHarness() {
  const committedSelection = useOverlay((s) => s.selection);
  const selectionInteraction = useOverlay((s) => s.selectionInteraction);
  const scaleFactor = useOverlay((s) => s.scaleFactor);

  const onMouseDown = (e: React.MouseEvent) => {
    const p = { x: e.clientX, y: e.clientY };
    const state = useOverlay.getState();
    if (state.mode !== "committed" || !state.selection) return;
    if (hitTestHandle(p, state.selection, 10)) return;
    if (rectContainsPoint(state.selection, p)) {
      state.beginMove(p);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const state = useOverlay.getState();
    if (!state.selectionInteraction) return;
    state.updateSelectionInteraction({ x: e.clientX, y: e.clientY });
  };

  const onMouseUp = () => {
    useOverlay.getState().finishSelectionInteraction();
  };

  return (
    <div
      data-move-parent
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {committedSelection && (
        <AnnotationStage
          selection={committedSelection}
          scaleFactor={scaleFactor}
          interacting={!!selectionInteraction}
        />
      )}
    </div>
  );
}

describe("AnnotationStage selection movement", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContextMock(this: HTMLCanvasElement) {
      const context = {
        canvas: this,
        measureText: vi.fn(() => ({ width: 40 })),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createPattern: vi.fn(() => null),
      };
      return new Proxy(context, {
        get(target, prop) {
          if (prop in target) return target[prop as keyof typeof target];
          return vi.fn();
        },
      }) as unknown as CanvasRenderingContext2D;
    });
  });

  beforeEach(() => {
    installImageMock();
    localStorage.clear();
    useAnnotation.getState().reset();
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
    useOverlay.getState().commit(selection);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useAnnotation.getState().reset();
    useOverlay.getState().end();
  });

  it("uses the move cursor over the committed screenshot area by default", () => {
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={2} />);

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    expect(stageNode.style.cursor).toBe("move");
  });

  it("uses the crosshair cursor while the committed color picker is visible", () => {
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={2} />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    expect(stageNode.style.cursor).toBe("move");

    act(() => {
      useOverlay.getState().toggleColorPicker();
    });

    expect(stageNode.style.cursor).toBe("crosshair");

    act(() => {
      useOverlay.getState().toggleColorPicker();
    });

    expect(stageNode.style.cursor).toBe("move");
  });

  it("uses the selected annotation tool cursor inside the committed screenshot area", () => {
    useAnnotation.getState().setActiveTool("rect");

    const { container } = render(<AnnotationStage selection={selection} scaleFactor={2} />);

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;
    expect(stageNode.style.cursor).toBe("crosshair");
  });

  it("allows corner resize handles to change width and height freely", () => {
    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    expect(getTransformer()?.keepRatio()).toBe(false);
    expect(getTransformer()?.shiftBehavior()).toBe("none");
  });

  it("uses zoom-in for circle magnifiers and crosshair for rectangular magnifiers", () => {
    useAnnotation.getState().setActiveTool("magnifier");
    useAnnotation.getState().setActiveStyle({ magnifierShape: "circle" });

    const { container, rerender } = render(<AnnotationStage selection={selection} scaleFactor={2} />);

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;
    expect(stageNode.style.cursor).toBe("zoom-in");

    act(() => {
      useAnnotation.getState().setActiveStyle({ magnifierShape: "rounded-rect" });
    });
    rerender(<AnnotationStage selection={selection} scaleFactor={2} />);

    expect(stageNode.style.cursor).toBe("crosshair");
  });

  it("draws magnifier selection previews with a lightweight stroke", () => {
    useAnnotation.getState().setActiveTool("magnifier");
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={2} />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    act(() => {
      fireEvent.mouseDown(stageNode, { clientX: 20, clientY: 24 });
    });

    const preview = getLayer()?.getChildren((node) => (
      node instanceof Konva.Rect && Array.isArray(node.dash()) && node.dash().length > 0
    ))[0] as Konva.Rect | undefined;

    expect(preview?.strokeWidth()).toBe(1);
  });

  it("selects a completed magnifier so it can be resized immediately", () => {
    useAnnotation.getState().setActiveTool("magnifier");
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={2} />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    act(() => {
      fireEvent.mouseDown(stageNode, { clientX: 40, clientY: 50 });
      fireEvent.mouseMove(stageNode, { clientX: 140, clientY: 150 });
      fireEvent.mouseUp(stageNode, { clientX: 140, clientY: 150 });
    });

    const magnifier = useAnnotation.getState().objects.find((obj) => obj.type === "magnifier");
    expect(magnifier).toBeTruthy();
    expect(useAnnotation.getState().selectedObjectId).toBe(magnifier?.id);
    expect(getTransformer()?.nodes().map((node) => node.id())).toEqual([magnifier?.id]);
  });

  it("restores the selected annotation tool cursor when the color picker is hidden", () => {
    useAnnotation.getState().setActiveTool("text");
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={2} />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    expect(stageNode.style.cursor).toBe("text");

    act(() => {
      useOverlay.getState().toggleColorPicker();
    });

    expect(stageNode.style.cursor).toBe("crosshair");

    act(() => {
      useOverlay.getState().toggleColorPicker();
    });

    expect(stageNode.style.cursor).toBe("text");
  });

  it("lets empty committed screenshot drags move the whole selection", () => {
    const { container } = render(<MoveHarness />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    act(() => {
      fireEvent.mouseDown(stageNode, { clientX: 150, clientY: 160 });
      fireEvent.mouseMove(stageNode, { clientX: 190, clientY: 200 });
      fireEvent.mouseUp(stageNode);
    });

    expect(useOverlay.getState().selection).toEqual({
      x: 140,
      y: 160,
      width: 240,
      height: 160,
    });
    expect(useOverlay.getState().selectionInteraction).toBeNull();
  });

  it("keeps existing annotations visible while moving the whole selection", () => {
    useAnnotation.getState().addObject(annotatedRect);
    const { container } = render(<MoveHarness />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    act(() => {
      fireEvent.mouseDown(stageNode, { clientX: 150, clientY: 160 });
    });

    expect(useOverlay.getState().selectionInteraction?.kind).toBe("move");
    expect(stageNode.style.visibility).toBe("visible");
  });


  it("creates a magnifier render context from the frozen frame and filters the current lens", async () => {
    const lensLikeObject: AnnotationObject = {
      id: "lens-1",
      type: "marker",
      start: { x: 80, y: 60 },
      markerNumber: 1,
      style: { color: "#0099ff", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(annotatedRect);
    useAnnotation.getState().addObject(lensLikeObject);

    render(<AnnotationStage selection={selection} scaleFactor={2} frameUrl={capture.frameUrl} />);

    await vi.waitFor(() => {
      const context = (StageModule as typeof StageModule & {
        getMagnifierRenderContext?: (excludeObjectId?: string) => {
          sourceImage: HTMLImageElement;
          stageSize: { width: number; height: number };
          scaleFactor: number;
          objects: AnnotationObject[];
        } | null;
      }).getMagnifierRenderContext?.("lens-1");

      expect(context?.sourceImage).toBeInstanceOf(Image);
      expect(context?.stageSize).toEqual({ width: 240, height: 160 });
      expect(context?.scaleFactor).toBe(2);
      expect(context?.objects.map((obj) => obj.id)).toEqual(["rect-1"]);
    });
  });

  it("keeps magnifier transformer scale until resize is persisted", () => {
    const magnifier: AnnotationObject = {
      id: "magnifier-1",
      type: "magnifier",
      start: { x: 40, y: 50 },
      end: { x: 140, y: 150 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        magnifierShape: "rounded-rect",
        magnifierZoom: 2,
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    act(() => {
      useAnnotation.getState().addObject(magnifier);
      useAnnotation.getState().setSelectedObject(magnifier.id);
    });

    const node = getLayer()?.findOne("#magnifier-1") as Konva.Group | undefined;
    const transformer = getTransformer();
    expect(node).toBeInstanceOf(Konva.Group);
    expect(transformer?.nodes()).toEqual([node]);

    act(() => {
      node!.scaleX(2);
      node!.scaleY(1.5);
      transformer?.fire("transform");
      transformer?.fire("transformend");
    });

    const resized = useAnnotation.getState().objects.find((obj) => obj.id === magnifier.id);
    expect(resized?.start).toEqual({ x: 40, y: 50 });
    expect(resized?.end).toEqual({ x: 240, y: 200 });
  });

  it("bakes shape resize scale into bounds so selection and corner radius stay aligned", () => {
    const rect: AnnotationObject = {
      id: "rounded-rect-1",
      type: "rect",
      start: { x: 20, y: 24 },
      end: { x: 100, y: 80 },
      style: { color: "#ff0000", strokeWidth: 4, fill: "hollow", cornerRadius: 12 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    act(() => {
      useAnnotation.getState().addObject(rect);
      useAnnotation.getState().setSelectedObject(rect.id);
    });

    const node = getLayer()?.findOne("#rounded-rect-1") as Konva.Rect | undefined;
    const transformer = getTransformer();
    expect(node).toBeInstanceOf(Konva.Rect);

    act(() => {
      node!.scaleX(2);
      node!.scaleY(1.5);
      transformer?.fire("transformend");
    });

    const resized = useAnnotation.getState().objects.find((obj) => obj.id === rect.id);
    expect(resized?.start).toEqual({ x: 20, y: 24 });
    expect(resized?.end).toEqual({ x: 180, y: 108 });
    expect(resized?.transform).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });

    const rerendered = getLayer()?.findOne("#rounded-rect-1") as Konva.Rect | undefined;
    expect(rerendered?.width()).toBe(160);
    expect(rerendered?.height()).toBe(84);
    expect(rerendered?.scaleX()).toBe(1);
    expect(rerendered?.scaleY()).toBe(1);
    expect(rerendered?.cornerRadius()).toBe(12);
    expect(transformer?.nodes()).toEqual([rerendered]);
  });

  it("keeps rounded rectangle nodes unscaled while transformer resize is active", () => {
    const rect: AnnotationObject = {
      id: "live-rounded-rect-1",
      type: "rect",
      start: { x: 20, y: 24 },
      end: { x: 100, y: 80 },
      style: { color: "#ff0000", strokeWidth: 4, fill: "hollow", cornerRadius: 12 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    act(() => {
      useAnnotation.getState().addObject(rect);
      useAnnotation.getState().setSelectedObject(rect.id);
    });

    const node = getLayer()?.findOne("#live-rounded-rect-1") as Konva.Rect | undefined;
    const transformer = getTransformer();
    expect(node).toBeInstanceOf(Konva.Rect);

    act(() => {
      node!.scaleX(2);
      node!.scaleY(1.5);
      transformer?.fire("transform");
    });

    expect(node?.width()).toBe(160);
    expect(node?.height()).toBe(84);
    expect(node?.scaleX()).toBe(1);
    expect(node?.scaleY()).toBe(1);
    expect(node?.cornerRadius()).toBe(12);
    expect(transformer?.nodes()).toEqual([node]);
  });

  it("keeps resized circle spotlight masks aligned with non-proportional bounds", () => {
    const spotlight: AnnotationObject = {
      id: "circle-spotlight-1",
      type: "spotlight",
      start: { x: 20, y: 24 },
      end: { x: 80, y: 84 },
      style: { color: "#ff0000", strokeWidth: 4, fill: "spotlight", spotlightShape: "circle" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    act(() => {
      useAnnotation.getState().addObject(spotlight);
      useAnnotation.getState().setSelectedObject(spotlight.id);
    });

    const node = getLayer()?.findOne("#circle-spotlight-1") as Konva.Ellipse | undefined;
    const transformer = getTransformer();
    expect(node).toBeInstanceOf(Konva.Ellipse);

    act(() => {
      node!.scaleX(2);
      node!.scaleY(1);
      transformer?.fire("transformend");
    });

    const mask = getLayer()?.findOne(".focus-mask") as Konva.Shape | undefined;
    const [hole] = mask?.getAttr("focusHoles") ?? [];
    expect(hole.kind).toBe("ellipse");
    expect(hole.width).toBe(120);
    expect(hole.height).toBe(60);
  });

  it("keeps circle spotlight masks aligned while transformer resize is active", () => {
    const spotlight: AnnotationObject = {
      id: "live-circle-spotlight-1",
      type: "spotlight",
      start: { x: 20, y: 24 },
      end: { x: 80, y: 84 },
      style: { color: "#ff0000", strokeWidth: 4, fill: "spotlight", spotlightShape: "circle" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    act(() => {
      useAnnotation.getState().addObject(spotlight);
      useAnnotation.getState().setSelectedObject(spotlight.id);
    });

    const node = getLayer()?.findOne("#live-circle-spotlight-1") as Konva.Ellipse | undefined;
    const transformer = getTransformer();
    expect(node).toBeInstanceOf(Konva.Ellipse);

    act(() => {
      node!.scaleX(2);
      node!.scaleY(1);
      transformer?.fire("transform");
    });

    expect(node?.radiusX()).toBe(60);
    expect(node?.radiusY()).toBe(30);
    expect(node?.scaleX()).toBe(1);
    expect(node?.scaleY()).toBe(1);

    const mask = getLayer()?.findOne(".focus-mask") as Konva.Shape | undefined;
    const [hole] = mask?.getAttr("focusHoles") ?? [];
    expect(hole.kind).toBe("ellipse");
    expect(hole.width).toBe(120);
    expect(hole.height).toBe(60);
  });

  it("shows endpoint handles instead of a transformer for straight highlights", () => {
    const highlight: AnnotationObject = {
      id: "straight-highlight-1",
      type: "highlight",
      start: { x: 20, y: 24 },
      end: { x: 120, y: 64 },
      points: [20, 24, 120, 64],
      style: { color: "#ffff00", strokeWidth: 4, highlightMode: "straight", cornerRadius: 8 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    act(() => {
      useAnnotation.getState().addObject(highlight);
      useAnnotation.getState().setSelectedObject(highlight.id);
    });

    expect(getTransformer()?.nodes()).toEqual([]);
    expect(getLayer()?.find(".line-edit-handle")).toHaveLength(2);
    expect(getLayer()?.find(".line-edit-start")).toHaveLength(1);
    expect(getLayer()?.find(".line-edit-end")).toHaveLength(1);
    expect(getLayer()?.find(".line-edit-control")).toHaveLength(0);
  });

  it("updates straight highlight endpoints from edit handles", () => {
    const highlight: AnnotationObject = {
      id: "editable-straight-highlight-1",
      type: "highlight",
      start: { x: 20, y: 24 },
      end: { x: 120, y: 64 },
      points: [20, 24, 120, 64],
      style: { color: "#ffff00", strokeWidth: 4, highlightMode: "straight", cornerRadius: 8 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    act(() => {
      useAnnotation.getState().addObject(highlight);
      useAnnotation.getState().setSelectedObject(highlight.id);
    });

    const startHandle = getLayer()?.findOne(".line-edit-start") as Konva.Circle | undefined;
    expect(startHandle).toBeInstanceOf(Konva.Circle);

    act(() => {
      startHandle!.position({ x: 32, y: 36 });
      startHandle!.fire("dragmove");
      startHandle!.fire("dragend");
    });

    const resized = useAnnotation.getState().objects.find((obj) => obj.id === highlight.id);
    expect(resized?.start).toEqual({ x: 32, y: 36 });
    expect(resized?.end).toEqual({ x: 120, y: 64 });
    expect(resized?.points).toEqual([32, 36, 120, 64]);
  });

  it("uses a move-only transformer for freehand highlights", () => {
    const highlight: AnnotationObject = {
      id: "freehand-highlight-1",
      type: "highlight",
      points: [20, 24, 48, 32, 88, 44, 120, 64],
      style: { color: "#ffff00", strokeWidth: 4, highlightMode: "freehand", cornerRadius: 8 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };

    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    act(() => {
      useAnnotation.getState().addObject(highlight);
      useAnnotation.getState().setSelectedObject(highlight.id);
    });

    const node = getLayer()?.findOne("#freehand-highlight-1") as Konva.Group | undefined;
    expect(getTransformer()?.nodes()).toEqual([node]);
    expect(getTransformer()?.enabledAnchors()).toEqual([]);
    expect(getLayer()?.find(".line-edit-handle")).toHaveLength(0);
  });

  it("shows the shared spotlight mask as soon as spotlight rectangle drawing starts", () => {
    useAnnotation.getState().setActiveTool("spotlight");
    useAnnotation.getState().setActiveStyle({ spotlightShape: "rect" });
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={2} />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    act(() => {
      fireEvent.mouseDown(stageNode, { clientX: 20, clientY: 24 });
    });

    const mask = getLayer()?.findOne(".focus-mask") as Konva.Shape | undefined;
    expect(mask).toBeInstanceOf(Konva.Shape);
    expect(mask?.getAttr("focusHoles")).toHaveLength(1);
  });

  it("creates circle spotlight annotations through the standalone spotlight tool", () => {
    useAnnotation.getState().setActiveTool("spotlight");
    useAnnotation.getState().setActiveStyle({ spotlightShape: "circle" });
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={2} />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    act(() => {
      fireEvent.mouseDown(stageNode, { clientX: 20, clientY: 24 });
      fireEvent.mouseMove(stageNode, { clientX: 80, clientY: 84 });
      fireEvent.mouseUp(stageNode, { clientX: 80, clientY: 84 });
    });

    const spotlight = useAnnotation.getState().objects.find((obj) => obj.type === "spotlight");
    expect(spotlight?.style.fill).toBe("spotlight");
    expect(spotlight?.style.spotlightShape).toBe("circle");

    const mask = getLayer()?.findOne(".focus-mask") as Konva.Shape | undefined;
    expect(mask?.getAttr("focusHoles")?.[0]?.kind).toBe("ellipse");
  });

  it("renders all spotlight annotations through one shared mask when selection dimensions change", () => {
    const focusedRect: AnnotationObject = {
      ...annotatedRect,
      id: "focused-rect",
      type: "spotlight",
      style: { ...annotatedRect.style, fill: "spotlight", spotlightShape: "rect" },
    };
    const focusedEllipse: AnnotationObject = {
      ...annotatedRect,
      id: "focused-circle",
      type: "spotlight",
      start: { x: 130, y: 40 },
      end: { x: 210, y: 110 },
      style: { ...annotatedRect.style, fill: "spotlight", spotlightShape: "circle" },
    };
    const { rerender } = render(<AnnotationStage selection={selection} scaleFactor={2} />);

    act(() => {
      useAnnotation.getState().addObject(focusedRect);
      useAnnotation.getState().addObject(focusedEllipse);
    });

    let masks = getLayer()?.find(".focus-mask") ?? [];
    expect(masks).toHaveLength(1);
    let mask = masks[0] as Konva.Shape | undefined;
    expect(mask).toBeInstanceOf(Konva.Shape);
    expect(mask?.getAttr("focusHoles")).toHaveLength(2);
    expect(mask?.getAttr("focusStageWidth")).toBe(240);
    expect(mask?.getAttr("focusStageHeight")).toBe(160);

    rerender(<AnnotationStage selection={{ ...selection, width: 320, height: 210 }} scaleFactor={2} />);

    masks = getLayer()?.find(".focus-mask") ?? [];
    expect(masks).toHaveLength(1);
    mask = masks[0] as Konva.Shape | undefined;
    expect(mask).toBeInstanceOf(Konva.Shape);
    expect(mask?.getAttr("focusHoles")).toHaveLength(2);
    expect(mask?.getAttr("focusStageWidth")).toBe(320);
    expect(mask?.getAttr("focusStageHeight")).toBe(210);
  });
});
