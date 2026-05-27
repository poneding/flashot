/** @vitest-environment jsdom */
import { exportAnnotationLayer } from "@/annotation/export";
import { useAnnotation } from "@/annotation/store";
import { currentCursorPointInWindow } from "@/lib/cursor";
import {
  cancelCapture,
  cropAndCopy,
  cropAndSave,
  pinImage,
  requestColorCopy,
  requestColorFormatToggle,
  startScrollSession,
} from "@/lib/ipc";
import type { CaptureStartPayload } from "@/lib/types";
import { DEFAULT_IMAGE_ADJUSTMENTS } from "@/overlay/imageAdjustments";
import { useOverlay } from "@/overlay/state";
import { OverlayRoute } from "@/routes/Overlay";
import { clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcListeners = vi.hoisted(() => ({
  colorFormatToggleRequested: undefined as undefined | (() => void),
  colorCopyRequested: undefined as undefined | (() => void),
}));

const annotationStageMock = vi.hoisted(() => vi.fn((_props: Record<string, unknown>) => null));

const webviewWindowMock = vi.hoisted(() => ({
  setFocus: vi.fn().mockResolvedValue(undefined),
  setCursorIcon: vi.fn().mockResolvedValue(undefined),
}));

const clipboardMock = vi.hoisted(() => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

const coreMock = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: vi.fn((path: string) => `mock://asset/${path}`),
}));

vi.mock("@/annotation/Stage", () => ({
  AnnotationStage: annotationStageMock,
}));

vi.mock("@/annotation/export", () => ({
  exportAnnotationLayer: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ipc", () => ({
  cancelCapture: vi.fn(),
  claimSelection: vi.fn().mockResolvedValue(undefined),
  cropAndCopy: vi.fn().mockResolvedValue(undefined),
  cropAndSave: vi.fn().mockResolvedValue(null),
  getSettings: vi.fn().mockResolvedValue({ accentColor: "#0EA5E9" }),
  onCaptureEnd: vi.fn().mockResolvedValue(vi.fn()),
  onCaptureStart: vi.fn().mockResolvedValue(vi.fn()),
  onQuickShotFlash: vi.fn().mockResolvedValue(vi.fn()),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
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
  startScrollSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/cursor", () => ({
  currentCursorPointInWindow: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => webviewWindowMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: coreMock.convertFileSrc,
  invoke: coreMock.invoke,
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
  cornerRadius: 0,
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
    annotationStageMock.mockClear();
    webviewWindowMock.setFocus.mockClear();
    webviewWindowMock.setCursorIcon.mockClear();
    clipboardMock.writeText.mockClear();
    coreMock.convertFileSrc.mockClear();
    coreMock.invoke.mockClear();
    coreMock.invoke.mockResolvedValue(undefined);
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => { }));
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

  it("keeps pointer-event cursor state when a polled cursor reports the origin", async () => {
    vi.mocked(currentCursorPointInWindow).mockResolvedValue({ x: 0, y: 0 });
    const { container } = render(<OverlayRoute />);
    const captureSurface = container.firstElementChild as HTMLElement;

    fireEvent.mouseMove(captureSurface, { clientX: 180, clientY: 180 });

    await waitFor(() => {
      expect(currentCursorPointInWindow).toHaveBeenCalled();
    });
    expect(useOverlay.getState().cursor).toEqual({ x: 180, y: 180 });
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
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));

    await waitFor(() => {
      expect(exportAnnotationLayer).toHaveBeenCalledWith(2);
      expect(pinImage).toHaveBeenCalledWith(1, selection, annotationPng, 0, DEFAULT_IMAGE_ADJUSTMENTS);
    });
  });

  it.each([
    ["Copy", cropAndCopy],
    ["Save As", cropAndSave],
    ["Pin", pinImage],
  ])("passes the live corner radius and image adjustments when using %s", async (buttonTitle, action) => {
    const annotationPng = new Uint8Array([137, 80, 78, 71]).buffer;
    const selection = { x: 100, y: 120, width: 240, height: 160 };
    const adjustments = { ...DEFAULT_IMAGE_ADJUSTMENTS, grayscale: true, brightness: 25 };
    vi.mocked(exportAnnotationLayer).mockResolvedValue(annotationPng);
    useOverlay.getState().commit(selection);
    useOverlay.setState({ cornerRadius: 18 });
    useOverlay.getState().setImageAdjustments(adjustments);

    render(<OverlayRoute />);
    fireEvent.click(screen.getByRole("button", { name: buttonTitle }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledWith(1, selection, annotationPng, 18, adjustments);
    });
  });

  it("cancels capture with Escape even when a corner radius preset is focused", () => {
    const selection = { x: 100, y: 120, width: 240, height: 160 };
    useOverlay.getState().commit(selection);

    render(<OverlayRoute />);
    fireEvent.click(screen.getByLabelText(/corner radius/i));
    const preset = screen.getByRole("button", { name: "Corner radius: 16 px" });
    preset.focus();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(cancelCapture).toHaveBeenCalledTimes(1);
  });

  it("shows a startup state before the backend captures the initial scroll frame", async () => {
    const selection = { x: 100, y: 120, width: 240, height: 160 };
    vi.mocked(startScrollSession).mockReturnValueOnce(new Promise<void>(() => { }));
    useOverlay.getState().commit(selection);

    render(<OverlayRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Scrolling screenshot" }));

    expect(useOverlay.getState().mode).toBe("scrollStarting");
    expect(screen.getByText("Starting...")).toBeTruthy();
    await waitFor(() => {
      expect(startScrollSession).toHaveBeenCalledWith(1, selection);
    });
  });

  it("enters scrolling mode after the backend starts the scroll session", async () => {
    const selection = { x: 100, y: 120, width: 240, height: 160 };
    vi.mocked(startScrollSession).mockResolvedValueOnce(undefined);
    useOverlay.getState().commit(selection);

    render(<OverlayRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Scrolling screenshot" }));

    await waitFor(() => {
      expect(useOverlay.getState().mode).toBe("scrolling");
    });
  });

  it("restores the committed selection if scrolling capture fails to start", async () => {
    const selection = { x: 100, y: 120, width: 240, height: 160 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.mocked(startScrollSession).mockRejectedValueOnce(new Error("initial capture failed"));
    useOverlay.getState().commit(selection);

    try {
      render(<OverlayRoute />);
      fireEvent.click(screen.getByRole("button", { name: "Scrolling screenshot" }));

      await waitFor(() => {
        expect(useOverlay.getState().mode).toBe("committed");
        expect(useOverlay.getState().selection).toEqual(selection);
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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

  it("uses the native crosshair cursor while the committed color picker is visible", async () => {
    render(<OverlayRoute />);

    act(() => {
      useOverlay.getState().commit({ x: 100, y: 120, width: 200, height: 160 });
    });
    await waitFor(() => {
      expect(webviewWindowMock.setCursorIcon).toHaveBeenCalledWith("default");
    });

    webviewWindowMock.setCursorIcon.mockClear();
    act(() => {
      useOverlay.getState().toggleColorPicker();
    });
    await waitFor(() => {
      expect(webviewWindowMock.setCursorIcon).toHaveBeenCalledWith("crosshair");
    });

    webviewWindowMock.setCursorIcon.mockClear();
    act(() => {
      useOverlay.getState().toggleColorPicker();
    });
    await waitFor(() => {
      expect(webviewWindowMock.setCursorIcon).toHaveBeenCalledWith("default");
    });
  });

  it("broadcasts hover color format shortcuts instead of mutating the focused overlay", () => {
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => { }));

    render(<OverlayRoute />);
    fireEvent.keyDown(window, { key: "x" });

    expect(requestColorFormatToggle).toHaveBeenCalledTimes(1);
    expect(useOverlay.getState().colorFormat).toBe("hex");
  });

  it("applies broadcast color format shortcuts only in the overlay under the cursor", async () => {
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => { }));
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
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => { }));
    useOverlay.getState().setCurrentColor({ r: 1, g: 2, b: 3 });

    render(<OverlayRoute />);
    fireEvent.keyDown(window, { key: "c" });

    expect(requestColorCopy).toHaveBeenCalledTimes(1);
    expect(clipboardMock.writeText).not.toHaveBeenCalled();
  });

  it("copies color after a broadcast only in the overlay under the cursor", async () => {
    vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise<null>(() => { }));
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
