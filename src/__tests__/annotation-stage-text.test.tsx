/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationStage, getLayer, getStage } from "@/annotation/Stage";
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


  it("opens marker editor after creation and commits bubble text", () => {
    useAnnotation.getState().setActiveTool("marker");
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={1} />);
    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;

    fireEvent.mouseDown(stageNode, { clientX: 60, clientY: 70 });
    fireEvent.mouseUp(stageNode, { clientX: 60, clientY: 70 });

    const created = useAnnotation.getState().objects[0];
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(created.type).toBe("marker");
    expect(useAnnotation.getState().selectedObjectId).toBe(created.id);
    expect(textarea).not.toBeNull();

    fireEvent.input(textarea!, { target: { value: "Review this" } });
    fireEvent.keyDown(textarea!, { key: "Enter" });

    expect(useAnnotation.getState().objects[0].text).toBe("Review this");
    expect(container.querySelector("textarea")).toBeNull();
    expect(getLayer()?.findOne(".marker-bubble")).not.toBeUndefined();
  });

  it("opens marker editor on selection and hides the bubble for empty text", () => {
    const { container } = render(<AnnotationStage selection={selection} scaleFactor={1} />);

    act(() => {
      useAnnotation.getState().addObject(markerObject({ text: "Old note" }));
    });

    const stageNode = container.querySelector("[data-annotation-stage]") as HTMLElement;
    const node = getLayer()?.findOne("#marker-1");
    vi.spyOn(getStage()!, "getIntersection").mockReturnValue(node as never);

    fireEvent.mouseDown(stageNode, { clientX: 50, clientY: 58, detail: 1 });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe("Old note");

    fireEvent.input(textarea!, { target: { value: "   " } });
    fireEvent.keyDown(textarea!, { key: "Enter" });

    expect(useAnnotation.getState().objects[0].text).toBe("");
    expect(getLayer()?.findOne(".marker-bubble")).toBeUndefined();
  });
});
