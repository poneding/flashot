/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportAnnotationLayer } from "@/annotation/export";
import { useAnnotation } from "@/annotation/store";
import { pinImage } from "@/lib/ipc";
import { OverlayRoute } from "@/routes/Overlay";
import { currentCursorPointInWindow } from "@/lib/cursor";
import { useOverlay } from "@/overlay/state";
import type { CaptureStartPayload } from "@/lib/types";

vi.mock("@/annotation/Stage", () => ({
  AnnotationStage: () => null,
}));

vi.mock("@/annotation/export", () => ({
  exportAnnotationLayer: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ipc", () => ({
  cancelCapture: vi.fn(),
  claimSelection: vi.fn().mockResolvedValue(undefined),
  cropAndCopy: vi.fn().mockResolvedValue(undefined),
  cropAndSave: vi.fn().mockResolvedValue(null),
  onCaptureEnd: vi.fn().mockResolvedValue(vi.fn()),
  onCaptureStart: vi.fn().mockResolvedValue(vi.fn()),
  onQuickShotFlash: vi.fn().mockResolvedValue(vi.fn()),
  onSelectionClaimed: vi.fn().mockResolvedValue(vi.fn()),
  onSelectionReleased: vi.fn().mockResolvedValue(vi.fn()),
  pinImage: vi.fn().mockResolvedValue("pin-1"),
  releaseSelection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/cursor", () => ({
  currentCursorPointInWindow: vi.fn().mockResolvedValue(null),
}));

const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost//Users/dp/Library/Caches/dev.flashot.app/frame_1.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
};

describe("OverlayRoute", () => {
  beforeEach(() => {
    mockConvertFileSrc("macos");
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => {}));
    useAnnotation.getState().reset();
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
  });

  afterEach(() => {
    cleanup();
    clearMocks();
    vi.clearAllMocks();
    useAnnotation.getState().reset();
    useOverlay.getState().end();
  });

  it("keeps the capture surface transparent while the frozen frame decodes", () => {
    const { container } = render(<OverlayRoute />);
    const captureSurface = container.firstElementChild as HTMLElement | null;

    expect(captureSurface?.style.background).toBe("transparent");
  });

  it("does not draw the background mask before a default target is known", () => {
    const { container } = render(<OverlayRoute />);
    const fullScreenMask = Array.from(container.querySelectorAll("div")).find((element) => {
      const el = element as HTMLElement;
      return el.style.inset === "0px" && el.style.background === "rgba(0, 0, 0, 0.55)";
    });

    expect(fullScreenMask).toBeUndefined();
  });

  it("falls back to the full monitor as the default target when the cursor is unavailable", async () => {
    vi.mocked(currentCursorPointInWindow).mockResolvedValue(null);

    render(<OverlayRoute />);

    await waitFor(() => {
      expect(useOverlay.getState().hoverRect).toEqual({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      });
    });
  });

  it("passes exported annotations when pinning the selected screenshot", async () => {
    const annotationPng = new Uint8Array([137, 80, 78, 71]).buffer;
    const selection = { x: 100, y: 120, width: 240, height: 160 };
    vi.mocked(exportAnnotationLayer).mockResolvedValue(annotationPng);
    useAnnotation.getState().addObject({
      id: "line-1",
      type: "line",
      start: { x: 8, y: 12 },
      end: { x: 120, y: 60 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });
    useOverlay.getState().commit(selection);

    render(<OverlayRoute />);
    fireEvent.click(screen.getByTitle("Pin"));

    await waitFor(() => {
      expect(exportAnnotationLayer).toHaveBeenCalledWith(2);
      expect(pinImage).toHaveBeenCalledWith(1, selection, annotationPng);
    });
  });
});
