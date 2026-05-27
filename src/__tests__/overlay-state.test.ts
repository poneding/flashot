import { beforeEach, describe, expect, it } from "vitest";
import { useOverlay } from "@/overlay/state";
import { DEFAULT_IMAGE_ADJUSTMENTS, frozenLayerFilterForImageAdjustments } from "@/overlay/imageAdjustments";
import type { CaptureStartPayload, Rect } from "@/lib/types";

const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost/frame.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
  cornerRadius: 0,
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
    expect(useOverlay.getState().hoverTarget).toBe("window");
  });

  it("does not notify subscribers when hover polling repeats the same point and target", () => {
    const windowRect = { x: 20, y: 30, width: 240, height: 160 };
    useOverlay.getState().start({
      ...capture,
      windows: [{ rect: windowRect, title: "Editor", appName: "Code", pid: 7 }],
    });

    let notifications = 0;
    const unsubscribe = useOverlay.subscribe(() => {
      notifications += 1;
    });

    try {
      useOverlay.getState().updateHoverAt({ x: 80, y: 90 });
      const afterFirstUpdate = notifications;

      useOverlay.getState().updateHoverAt({ x: 80, y: 90 });

      expect(notifications).toBe(afterFirstUpdate);
    } finally {
      unsubscribe();
    }
  });

  it("falls back to the full monitor when the cursor leaves detected windows", () => {
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

    expect(useOverlay.getState().hoverRect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(useOverlay.getState().hoverTarget).toBe("monitor");
  });

  it("clears hover target with hover", () => {
    useOverlay.getState().setHover({ x: 20, y: 30, width: 240, height: 160 });

    useOverlay.getState().clearHover();

    expect(useOverlay.getState().hoverRect).toBeNull();
    expect(useOverlay.getState().hoverTarget).toBeNull();
  });

  it("commits the full monitor on a zero-size click outside detected windows", () => {
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

    useOverlay.getState().beginDrag({ x: 700, y: 500 });
    useOverlay.getState().commitDrag();

    expect(useOverlay.getState().mode).toBe("committed");
    expect(useOverlay.getState().selection).toEqual({ x: 0, y: 0, width: 800, height: 600 });
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


describe("overlay image adjustments", () => {
  beforeEach(reset);

  it("uses no-op defaults for every capture session", () => {
    expect(useOverlay.getState().imageAdjustments).toEqual(DEFAULT_IMAGE_ADJUSTMENTS);

    useOverlay.getState().setImageAdjustments({ grayscale: true, brightness: 20 });
    useOverlay.getState().end();

    expect(useOverlay.getState().imageAdjustments).toEqual(DEFAULT_IMAGE_ADJUSTMENTS);

    useOverlay.getState().start(capture);

    expect(useOverlay.getState().imageAdjustments).toEqual(DEFAULT_IMAGE_ADJUSTMENTS);
  });

  it("clamps numeric adjustments and resets them on request", () => {
    useOverlay.getState().setImageAdjustments({
      grayscale: true,
      autoLevels: true,
      brightness: 180,
      contrast: -180,
      saturation: 240,
      sharpness: -20,
    });

    expect(useOverlay.getState().imageAdjustments).toEqual({
      grayscale: true,
      autoLevels: true,
      brightness: 100,
      contrast: -100,
      saturation: 100,
      sharpness: 0,
    });

    useOverlay.getState().resetImageAdjustments();

    expect(useOverlay.getState().imageAdjustments).toEqual(DEFAULT_IMAGE_ADJUSTMENTS);
  });

  it("builds a frozen-layer-only preview filter from normalized adjustments", () => {
    expect(frozenLayerFilterForImageAdjustments(DEFAULT_IMAGE_ADJUSTMENTS)).toBe("none");

    expect(frozenLayerFilterForImageAdjustments({
      grayscale: true,
      autoLevels: false,
      brightness: 25,
      contrast: -20,
      saturation: 35,
      sharpness: 40,
    })).toBe("grayscale(1) brightness(1.25) contrast(0.8) saturate(1.35)");
  });
});
