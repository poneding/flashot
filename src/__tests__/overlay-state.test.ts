import { beforeEach, describe, expect, it } from "vitest";
import { useOverlay } from "@/overlay/state";
import type { CaptureStartPayload, Rect } from "@/lib/types";

const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost/frame.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
};

function reset() {
  useOverlay.getState().end();
  useOverlay.getState().start(capture);
}

describe("overlay committed selection editing", () => {
  beforeEach(reset);

  it("moves a committed selection by cursor delta", () => {
    const sel: Rect = { x: 100, y: 120, width: 200, height: 160 };
    useOverlay.getState().commit(sel);

    useOverlay.getState().beginMove({ x: 140, y: 150 });
    useOverlay.getState().updateSelectionInteraction({ x: 190, y: 190 });
    useOverlay.getState().finishSelectionInteraction();

    expect(useOverlay.getState().selection).toEqual({
      x: 150,
      y: 160,
      width: 200,
      height: 160,
    });
    expect(useOverlay.getState().selectionInteraction).toBeNull();
    expect(useOverlay.getState().mode).toBe("committed");
  });

  it("resizes a committed selection from a handle", () => {
    const sel: Rect = { x: 100, y: 120, width: 200, height: 160 };
    useOverlay.getState().commit(sel);

    useOverlay.getState().beginResize("se", { x: 300, y: 280 });
    useOverlay.getState().updateSelectionInteraction({ x: 360, y: 310 });
    useOverlay.getState().finishSelectionInteraction();

    expect(useOverlay.getState().selection).toEqual({
      x: 100,
      y: 120,
      width: 260,
      height: 190,
    });
  });

  it("clears stale hover when starting a new drag from committed mode", () => {
    useOverlay.getState().setHover({ x: 20, y: 20, width: 100, height: 80 });
    useOverlay.getState().commit({ x: 100, y: 120, width: 200, height: 160 });

    useOverlay.getState().beginDrag({ x: 400, y: 400 });
    useOverlay.getState().commitDrag();

    expect(useOverlay.getState().mode).toBe("hover");
    expect(useOverlay.getState().selection).toBeNull();
    expect(useOverlay.getState().hoverRect).toBeNull();
  });
});
