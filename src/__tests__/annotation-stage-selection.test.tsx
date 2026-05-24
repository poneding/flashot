/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationStage } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";
import { hitTestHandle, rectContainsPoint } from "@/lib/geometry";
import type { CaptureStartPayload } from "@/lib/types";
import { useOverlay } from "@/overlay/state";

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
    localStorage.clear();
    useAnnotation.getState().reset();
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
    useOverlay.getState().commit(selection);
  });

  afterEach(() => {
    cleanup();
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
});
