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

describe("overlay hover detection", () => {
  beforeEach(reset);

  it("commits the hovered window on a zero-size click", () => {
    const windowRect = { x: 20, y: 30, width: 240, height: 160 };
    useOverlay.getState().setHover(windowRect);

    useOverlay.getState().beginDrag({ x: 80, y: 90 });
    useOverlay.getState().commitDrag();

    expect(useOverlay.getState().mode).toBe("committed");
    expect(useOverlay.getState().selection).toEqual(windowRect);
    expect(useOverlay.getState().dragStart).toBeNull();
  });

  it("updates hover immediately from a cursor point", () => {
    const windowRect = { x: 20, y: 30, width: 240, height: 160 };
    useOverlay.getState().start({
      ...capture,
      windows: [{ rect: windowRect, title: "Editor", appName: "Code", pid: 7 }],
    });

    useOverlay.getState().updateHoverAt({ x: 80, y: 90 });

    expect(useOverlay.getState().cursor).toEqual({ x: 80, y: 90 });
    expect(useOverlay.getState().hoverRect).toEqual(windowRect);
  });

  it("clears hover when the cursor leaves detected windows", () => {
    useOverlay.getState().start({
      ...capture,
      windows: [
        {
          rect: { x: 20, y: 30, width: 240, height: 160 },
          title: "Editor",
          appName: "Code",
          pid: 7,
        },
      ],
    });

    useOverlay.getState().updateHoverAt({ x: 80, y: 90 });
    useOverlay.getState().updateHoverAt({ x: 700, y: 500 });

    expect(useOverlay.getState().hoverRect).toBeNull();
  });
});

describe("overlay single selection ownership", () => {
  beforeEach(reset);

  it("locks this overlay when another monitor claims the selection", () => {
    useOverlay.getState().lockToPeer(2);

    expect(useOverlay.getState().mode).toBe("locked");
    expect(useOverlay.getState().hoverRect).toBeNull();
    expect(useOverlay.getState().selection).toBeNull();

    useOverlay.getState().beginDrag({ x: 40, y: 40 });

    expect(useOverlay.getState().mode).toBe("locked");
    expect(useOverlay.getState().dragStart).toBeNull();
  });

  it("does not lock the overlay that owns the selection", () => {
    useOverlay.getState().lockToPeer(1);

    expect(useOverlay.getState().mode).toBe("hover");
  });

  it("unlocks when the peer abandons selection before committing a region", () => {
    useOverlay.getState().lockToPeer(2);
    useOverlay.getState().unlockFromPeer(2);

    expect(useOverlay.getState().mode).toBe("hover");
  });
});
