/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SelectionBox } from "@/overlay/SelectionBox";
import { useOverlay } from "@/overlay/state";
import type { CaptureStartPayload } from "@/lib/types";

const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost/frame.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
};

describe("SelectionBox", () => {
  beforeEach(() => {
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
    useOverlay.getState().commit({ x: 100, y: 120, width: 240, height: 160 });
  });

  afterEach(() => {
    cleanup();
    useOverlay.getState().end();
  });

  it("uses the shared tooltip background and selection color for the dimensions badge", () => {
    render(<SelectionBox />);

    const dimensions = screen.getByText("240 × 160");

    expect(dimensions.style.background).toBe("rgba(18, 18, 18, 0.72)");
    expect(dimensions.style.color).toBe("rgb(78, 209, 255)");
  });

  it("uses crosshair cursors on resize handles while the color picker is visible", () => {
    useOverlay.getState().toggleColorPicker();
    const { container } = render(<SelectionBox />);

    const handle = container.querySelector("[data-handle='nw']") as HTMLElement;

    expect(handle.style.cursor).toBe("crosshair");
  });
});
