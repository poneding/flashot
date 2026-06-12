/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Konva from "konva";
import { AnnotationStage, getLayer, getStage, getTransformer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

vi.mock("@/lib/ipc", () => ({
  beginTextInputSession: vi.fn().mockResolvedValue(undefined),
  endTextInputSession: vi.fn().mockResolvedValue(undefined),
}));

const selection = { x: 0, y: 0, width: 320, height: 180 };

function textObject(): AnnotationObject {
  return {
    id: "text-1",
    type: "text",
    start: { x: 20, y: 30 },
    text: "hello",
    style: { color: "#ff0000", strokeWidth: 4, fontSize: 24 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

function markerObject(overrides: Partial<AnnotationObject> = {}): AnnotationObject {
  return {
    id: "marker-1",
    type: "marker",
    start: { x: 48, y: 56 },
    markerNumber: 1,
    text: "",
    style: {
      color: "#ff0000",
      strokeWidth: 4,
      markerFill: "#0099ff",
      markerTextColor: "#ffffff",
      markerBubbleFill: "#111827",
    },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    ...overrides,
  };
}

describe("AnnotationStage text interactions", () => {
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
    localStorage.clear();
    useAnnotation.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("selects existing text on single click so it can still be dragged", () => {
    useAnnotation.getState().setActiveTool("text");
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={1} />);
    const object = textObject();

    act(() => {
      useAnnotation.getState().addObject(object);
    });

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;
    const node = getLayer()?.findOne("#text-1");
    expect(node?.draggable()).toBe(true);
    vi.spyOn(getStage()!, "getIntersection").mockReturnValue(node as never);

    fireEvent.mouseDown(stageNode, { clientX: 24, clientY: 36, detail: 1 });

    expect(useAnnotation.getState().selectedObjectId).toBe("text-1");
    expect(useAnnotation.getState().objects.some((obj) => obj.id === "text-1")).toBe(true);
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("clears the selected text when starting a new text annotation", () => {
    useAnnotation.getState().setActiveTool("text");
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={1} />);
    const object = textObject();

    act(() => {
      useAnnotation.getState().addObject(object);
      useAnnotation.getState().setSelectedObject(object.id);
    });

    vi.spyOn(getStage()!, "getIntersection").mockReturnValue(null);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    fireEvent.mouseDown(stageNode, { clientX: 120, clientY: 80, detail: 1 });

    expect(useAnnotation.getState().selectedObjectId).toBeNull();
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("renders the annotation layer at the monitor scale factor", () => {
    render(<AnnotationStage selection={selection} scaleFactor={2} />);

    expect(getLayer()?.getCanvas().getPixelRatio()).toBe(2);
  });


  it("opens marker editor after creation and commits label text with an anchor", () => {
    useAnnotation.getState().setActiveTool("marker");
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={1} />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    fireEvent.mouseDown(stageNode, { clientX: 60, clientY: 70 });
    fireEvent.mouseUp(stageNode, { clientX: 60, clientY: 70 });

    const created = useAnnotation.getState().objects[0];
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(created.type).toBe("marker");
    expect(created.end).toBeUndefined();
    expect(useAnnotation.getState().selectedObjectId).toBeNull();
    expect(textarea).not.toBeNull();

    fireEvent.input(textarea!, { target: { value: "Review this" } });
    fireEvent.keyDown(textarea!, { key: "Enter" });

    const committed = useAnnotation.getState().objects[0];
    expect(committed.text).toBe("Review this");
    // First confirm fixes the label anchor right of the badge.
    expect(committed.end?.x).toBe(81);
    expect(committed.end?.y).toBeCloseTo(56.6);
    expect(container.querySelector("textarea")).toBeNull();
    expect(getLayer()?.findOne(".marker-label-box")).not.toBeUndefined();
    expect(getLayer()?.findOne(".marker-connector")).not.toBeUndefined();
  });

  it("selects marker on single click without opening the editor", () => {
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={1} />);

    act(() => {
      useAnnotation.getState().addObject(markerObject({ text: "Old note" }));
    });

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;
    const node = getLayer()?.findOne("#marker-1");
    vi.spyOn(getStage()!, "getIntersection").mockReturnValue(node as never);

    fireEvent.mouseDown(stageNode, { clientX: 50, clientY: 58, detail: 1 });
    fireEvent.mouseUp(stageNode, { clientX: 50, clientY: 58 });

    expect(useAnnotation.getState().selectedObjectId).toBe("marker-1");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("opens marker editor on double click and hides the label for empty text", () => {
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={1} />);

    act(() => {
      useAnnotation.getState().addObject(markerObject({ text: "Old note" }));
    });

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;
    const node = getLayer()?.findOne("#marker-1");
    vi.spyOn(getStage()!, "getIntersection").mockReturnValue(node as never);

    fireEvent.mouseDown(stageNode, { clientX: 50, clientY: 58, detail: 2 });
    fireEvent.mouseUp(stageNode, { clientX: 50, clientY: 58 });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe("Old note");
    expect(useAnnotation.getState().selectedObjectId).toBeNull();
    expect(getTransformer()?.nodes()).toHaveLength(0);

    fireEvent.input(textarea!, { target: { value: "   " } });
    fireEvent.keyDown(textarea!, { key: "Enter" });

    expect(useAnnotation.getState().objects[0].text).toBe("");
    expect(getLayer()?.findOne(".marker-label-box")).toBeUndefined();
    expect(getLayer()?.findOne(".marker-connector")).toBeUndefined();
  });

  it("does not open the marker editor while dragging a marker", () => {
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={1} />);

    act(() => {
      useAnnotation.getState().addObject(markerObject({ text: "Move me" }));
    });

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;
    const node = getLayer()?.findOne("#marker-1");
    vi.spyOn(getStage()!, "getIntersection").mockReturnValue(node as never);

    fireEvent.mouseDown(stageNode, { clientX: 50, clientY: 58, detail: 1 });
    fireEvent.mouseMove(stageNode, { clientX: 90, clientY: 92 });
    fireEvent.mouseUp(stageNode, { clientX: 90, clientY: 92 });

    expect(container.querySelector("textarea")).toBeNull();
  });

  it.each(["Backspace", "Delete"])("deletes a selected marker with %s", (key) => {
    render(<AnnotationStage selection={selection} scaleFactor={1} />);

    act(() => {
      useAnnotation.getState().addObject(markerObject({ text: "Remove me" }));
      useAnnotation.getState().setSelectedObject("marker-1");
    });

    fireEvent.keyDown(window, { key });

    expect(useAnnotation.getState().objects.some((obj) => obj.id === "marker-1")).toBe(false);
    expect(useAnnotation.getState().selectedObjectId).toBeNull();
  });

  it("keeps marker text editing anchored to the label after the badge moves", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-annotation-stage")) {
        return rect({ left: 24, top: 24, width: 320, height: 180 });
      }
      return rect();
    });

    const { container } = render(<AnnotationStage selection={{ ...selection, x: 0, y: 0 }} scaleFactor={1} />);

    act(() => {
      useAnnotation.getState().addObject(markerObject({ text: "Moved note" }));
    });

    const markerNode = getLayer()?.findOne("#marker-1") as Konva.Group;
    const badgePart = markerNode.findOne(".marker-badge-part") as Konva.Group;
    act(() => {
      badgePart.position({ x: 88, y: 96 });
      getStage()?.fire("dragend", { target: badgePart });
    });

    const moved = useAnnotation.getState().objects[0];
    expect(moved.start).toEqual({ x: 88, y: 96 });
    // The derived label anchor is baked into `end`; the label itself stays put.
    expect(moved.end).toEqual({ x: 69, y: 42.6 });
    expect(moved.transform).toMatchObject({ x: 0, y: 0 });

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;
    vi.spyOn(getStage()!, "getIntersection").mockReturnValue(getLayer()?.findOne("#marker-1") as never);

    fireEvent.mouseDown(stageNode, { clientX: 88, clientY: 96, detail: 2 });
    fireEvent.mouseUp(stageNode, { clientX: 88, clientY: 96 });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(textarea!.style.left).toBe("93px");
    expect(textarea!.style.top).toBe("66.6px");
  });

  it("positions marker editing from the rendered stage bounds and matches final label styling", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-annotation-stage")) {
        return rect({ left: 24, top: 24, width: 320, height: 180 });
      }
      return rect();
    });

    const { container } = render(<AnnotationStage selection={{ ...selection, x: 0, y: 0 }} scaleFactor={1} />);

    act(() => {
      useAnnotation.getState().addObject(markerObject({ text: "Pinned note" }));
    });

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;
    const node = getLayer()?.findOne("#marker-1");
    vi.spyOn(getStage()!, "getIntersection").mockReturnValue(node as never);

    fireEvent.mouseDown(stageNode, { clientX: 50, clientY: 58, detail: 2 });
    fireEvent.mouseUp(stageNode, { clientX: 50, clientY: 58 });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(textarea!.style.left).toBe("93px");
    expect(textarea!.style.top).toBe("66.6px");
    expect(textarea!.style.width).toBe("56px");
    expect(textarea!.style.height).toBe("26.8px");
    expect(textarea!.style.borderRadius).toBe("7px");
    expect(textarea!.style.fontSize).toBe("14px");
    // Glow chrome rendered in the badge color.
    expect(textarea!.style.borderStyle).toBe("solid");
    expect(textarea!.style.borderWidth).toBe("1.5px");
    expect(textarea!.style.boxShadow).toContain("#0099ff");
  });
});

function rect(partial: Partial<DOMRect> = {}): DOMRect {
  const left = partial.left ?? 0;
  const top = partial.top ?? 0;
  const width = partial.width ?? 0;
  const height = partial.height ?? 0;
  return {
    x: partial.x ?? left,
    y: partial.y ?? top,
    left,
    top,
    width,
    height,
    right: partial.right ?? left + width,
    bottom: partial.bottom ?? top + height,
    toJSON: () => ({}),
  } as DOMRect;
}
