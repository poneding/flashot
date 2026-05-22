/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportAnnotationLayer } from "@/annotation/export";
import { useAnnotation } from "@/annotation/store";
import { pinImage, requestColorCopy, requestColorFormatToggle } from "@/lib/ipc";
import { OverlayRoute } from "@/routes/Overlay";
import { currentCursorPointInWindow } from "@/lib/cursor";
import { useOverlay } from "@/overlay/state";
import type { CaptureStartPayload } from "@/lib/types";

const ipcListeners = vi.hoisted(() => ({
  colorFormatToggleRequested: undefined as undefined | (() => void),
  colorCopyRequested: undefined as undefined | (() => void),
}));

const webviewWindowMock = vi.hoisted(() => ({
  setFocus: vi.fn().mockResolvedValue(undefined),
  setCursorIcon: vi.fn().mockResolvedValue(undefined),
}));

const clipboardMock = vi.hoisted(() => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

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
  onColorFormatToggleRequested: vi.fn((cb: () => void) => {
    ipcListeners.colorFormatToggleRequested = cb;
    return Promise.resolve(vi.fn());
  }),
  onColorCopyRequested: vi.fn((cb: () => void) => {
    ipcListeners.colorCopyRequested = cb;
    return Promise.resolve(vi.fn());
  }),
  onSelectionClaimed: vi.fn().mockResolvedValue(vi.fn()),
  onSelectionReleased: vi.fn().mockResolvedValue(vi.fn()),
  pinImage: vi.fn().mockResolvedValue("pin-1"),
  requestColorCopy: vi.fn().mockResolvedValue(undefined),
  requestColorFormatToggle: vi.fn().mockResolvedValue(undefined),
  releaseSelection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/cursor", () => ({
  currentCursorPointInWindow: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => webviewWindowMock,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: clipboardMock.writeText,
}));

const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost//Users/dp/Library/Caches/dev.flashot.app/frame_1.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
};

function resetColorFormat() {
  if (useOverlay.getState().colorFormat !== "hex") {
    useOverlay.getState().toggleColorFormat();
  }
}

describe("OverlayRoute", () => {
  beforeEach(() => {
    mockConvertFileSrc("macos");
    ipcListeners.colorFormatToggleRequested = undefined;
    ipcListeners.colorCopyRequested = undefined;
    webviewWindowMock.setFocus.mockClear();
    webviewWindowMock.setCursorIcon.mockClear();
    clipboardMock.writeText.mockClear();
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => {}));
    useAnnotation.getState().reset();
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
    resetColorFormat();
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

  it("draws a full-screen mask before this overlay owns a detected target", () => {
    const { container } = render(<OverlayRoute />);
    const fullScreenMask = Array.from(container.querySelectorAll("div")).find((element) => {
      const el = element as HTMLElement;
      return (
        el.style.left === "0px" &&
        el.style.top === "0px" &&
        el.style.width === "800px" &&
        el.style.height === "600px" &&
        el.style.background === "rgba(0, 0, 0, 0.55)"
      );
    });

    expect(fullScreenMask).toBeDefined();
  });

  it("clears hover detection when the cursor is outside this overlay", async () => {
    vi.mocked(currentCursorPointInWindow).mockResolvedValue(null);
    useOverlay.getState().setHover({ x: 20, y: 30, width: 240, height: 160 });

    const { container } = render(<OverlayRoute />);

    await waitFor(() => {
      expect(useOverlay.getState().hoverRect).toBeNull();
    });

    const fullScreenMask = Array.from(container.querySelectorAll("div")).find((element) => {
      const el = element as HTMLElement;
      return (
        el.style.left === "0px" &&
        el.style.top === "0px" &&
        el.style.width === "800px" &&
        el.style.height === "600px" &&
        el.style.background === "rgba(0, 0, 0, 0.55)"
      );
    });

    expect(fullScreenMask).toBeDefined();
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

  it("sets the native overlay cursor to crosshair while hovering", async () => {
    render(<OverlayRoute />);

    await waitFor(() => {
      expect(webviewWindowMock.setCursorIcon).toHaveBeenCalledWith("crosshair");
    });
  });

  it("restores the native overlay cursor after hover selection is committed", async () => {
    render(<OverlayRoute />);
    webviewWindowMock.setCursorIcon.mockClear();

    act(() => {
      useOverlay.getState().commit({ x: 100, y: 120, width: 200, height: 160 });
    });

    await waitFor(() => {
      expect(webviewWindowMock.setCursorIcon).toHaveBeenCalledWith("default");
    });
  });

  it("broadcasts hover color format shortcuts instead of mutating the focused overlay", () => {
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => {}));

    render(<OverlayRoute />);
    fireEvent.keyDown(window, { key: "x" });

    expect(requestColorFormatToggle).toHaveBeenCalledTimes(1);
    expect(useOverlay.getState().colorFormat).toBe("hex");
  });

  it("applies broadcast color format shortcuts only in the overlay under the cursor", async () => {
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => {}));
    render(<OverlayRoute />);

    expect(ipcListeners.colorFormatToggleRequested).toBeDefined();
    vi.mocked(currentCursorPointInWindow).mockResolvedValue({ x: 120, y: 80 });
    await act(async () => {
      ipcListeners.colorFormatToggleRequested?.();
    });

    await waitFor(() => {
      expect(useOverlay.getState().colorFormat).toBe("rgb");
    });
    expect(webviewWindowMock.setFocus).toHaveBeenCalled();
  });

  it("broadcasts hover copy shortcuts instead of copying from the focused overlay", () => {
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => {}));
    useOverlay.getState().setCurrentColor({ r: 1, g: 2, b: 3 });

    render(<OverlayRoute />);
    fireEvent.keyDown(window, { key: "c" });

    expect(requestColorCopy).toHaveBeenCalledTimes(1);
    expect(clipboardMock.writeText).not.toHaveBeenCalled();
  });

  it("copies color after a broadcast only in the overlay under the cursor", async () => {
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => {}));
    useOverlay.getState().setCurrentColor({ r: 1, g: 2, b: 3 });
    render(<OverlayRoute />);

    expect(ipcListeners.colorCopyRequested).toBeDefined();
    vi.mocked(currentCursorPointInWindow).mockResolvedValue({ x: 120, y: 80 });
    await act(async () => {
      ipcListeners.colorCopyRequested?.();
    });

    await waitFor(() => {
      expect(clipboardMock.writeText).toHaveBeenCalledWith("#010203");
      expect(useOverlay.getState().colorCopied).toBe(true);
    });
    expect(webviewWindowMock.setFocus).toHaveBeenCalled();
  });
});
