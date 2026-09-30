/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportAnnotationLayer } from "@/annotation/export";
import { PinRoute } from "@/routes/Pin";
import { PinToolsRoute } from "@/routes/PinTools";
import type { PinAction, PinToolsEnvelope } from "@/pin/types";
import { closePin, copyPin, getSettings, pinInteractionContainsCursor, savePin, setPinScale, updatePinAnnotation } from "@/lib/ipc";
import { useOverlay } from "@/overlay/state";

const annotationStageMock = vi.hoisted(() => vi.fn());
const pinBus = vi.hoisted(() => ({
  snapshot: null as PinToolsEnvelope | null,
  action: null as ((action: PinAction) => void) | null,
  listeners: new Set<(state: PinToolsEnvelope) => void>(),
  revision: 0,
}));

function renderPin() {
  return render(<><PinRoute /><PinToolsRoute pinId="test-id" kind="controls" /><PinToolsRoute pinId="test-id" kind="editor" /></>);
}

async function showControls(root: HTMLElement) {
  fireEvent.mouseEnter(root);
  return await screen.findByTestId("pin-controls");
}

const webviewWindowMock = vi.hoisted(() => ({
  show: vi.fn().mockResolvedValue(undefined),
  startDragging: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appCacheDir: vi.fn().mockResolvedValue("/cache"),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => webviewWindowMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => webviewWindowMock,
}));

vi.mock("@/annotation/Stage", () => ({
  AnnotationStage: (props: Record<string, unknown>) => {
    annotationStageMock(props);
    return <div data-testid="pin-annotation-stage" />;
  },
}));

vi.mock("@/annotation/Toolbar", () => ({
  Toolbar: vi.fn(({ opaqueSurface, selection, placement }: {
    opaqueSurface?: boolean;
    selection: { x: number; y: number; width: number; height: number };
    placement?: string;
  }) => (
    <div
      data-testid="pin-annotation-toolbar"
      data-annotation-toolbar
      data-placement={placement}
      data-opaque-surface={opaqueSurface ? "true" : "false"}
      data-selection-x={selection.x}
      data-selection-y={selection.y}
      data-selection-width={selection.width}
      data-selection-height={selection.height}
    />
  )),
}));

vi.mock("@/annotation/export", () => ({
  exportAnnotationLayer: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ipc", () => ({
  closePin: vi.fn().mockResolvedValue(undefined),
  copyPin: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({ accentColor: "#0EA5E9", language: "en", theme: "system" }),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
  savePin: vi.fn().mockResolvedValue("/tmp/pin.png"),
  setPinScale: vi.fn().mockResolvedValue(undefined),
  pinInteractionContainsCursor: vi.fn().mockResolvedValue(false),
  updatePinAnnotation: vi.fn().mockResolvedValue(undefined),
  syncPinTools: vi.fn().mockImplementation(async (_id, state) => {
    const next = { pinId: _id, revision: ++pinBus.revision, state };
    pinBus.snapshot = next;
    pinBus.listeners.forEach(listener => listener(next));
  }),
  onPinAction: vi.fn().mockImplementation(async (callback) => { pinBus.action = callback; return () => { pinBus.action = null; }; }),
  sendPinAction: vi.fn().mockImplementation(async (_id, action) => { pinBus.action?.(action); }),
  getPinToolsState: vi.fn().mockImplementation(async () => pinBus.snapshot),
  onPinToolsState: vi.fn().mockImplementation(async (callback) => { pinBus.listeners.add(callback); return () => pinBus.listeners.delete(callback); }),
  onPinToolsPlacement: vi.fn().mockResolvedValue(() => {}),
  resizePinToolWindow: vi.fn().mockResolvedValue({ side: "right" }),
  beginPinResize: vi.fn().mockResolvedValue("gesture"),
  resizePin: vi.fn().mockResolvedValue(1.25),
  endPinResize: vi.fn().mockResolvedValue(undefined),
}));

describe("PinRoute", () => {
  beforeEach(() => {
    pinBus.snapshot = null;
    pinBus.action = null;
    pinBus.listeners.clear();
    pinBus.revision = 0;
    const raf = (callback: FrameRequestCallback) => { callback(0); return 0; };
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(raf);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.mocked(getSettings).mockResolvedValue({ accentColor: "#0EA5E9", language: "en", theme: "system" } as any);
    Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    Object.defineProperty(window, "screenX", { configurable: true, value: 100 });
    Object.defineProperty(window, "screenY", { configurable: true, value: 100 });
    Object.defineProperty(window.screen, "availLeft", { configurable: true, value: 0 });
    Object.defineProperty(window.screen, "availTop", { configurable: true, value: 0 });
    Object.defineProperty(window.screen, "availWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window.screen, "availHeight", { configurable: true, value: 900 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
    annotationStageMock.mockClear();
    vi.mocked(pinInteractionContainsCursor).mockReset().mockResolvedValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.location.hash = "";
    useOverlay.getState().end();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    Object.defineProperty(window, "screenX", { configurable: true, value: 100 });
    Object.defineProperty(window, "screenY", { configurable: true, value: 100 });
    Object.defineProperty(window.screen, "availLeft", { configurable: true, value: 0 });
    Object.defineProperty(window.screen, "availTop", { configurable: true, value: 0 });
    Object.defineProperty(window.screen, "availWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window.screen, "availHeight", { configurable: true, value: 900 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
  });

  it("layers exported annotations over the pinned screenshot when present", async () => {
    window.location.hash = "#/pin/test-id?annotation=1";

    renderPin();

    await waitFor(() => {
      expect(screen.getByAltText("Pinned screenshot").getAttribute("src")).toBe(
        "asset:///cache/pins/pin-test-id.png",
      );
      expect(screen.getByAltText("Pinned annotations").getAttribute("src")).toBe(
        "asset:///cache/pins/pin-test-id-annotation.png",
      );
    });
  });

  it("renders only the screenshot layer when no annotation flag is present", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await waitFor(() => {
      expect(screen.getByAltText("Pinned screenshot")).not.toBeNull();
    });
    expect(screen.queryByAltText("Pinned annotations")).toBeNull();
  });

  it("applies radius from the query string to the screenshot layer", async () => {
    window.location.hash = "#/pin/test-id?radius=8";

    renderPin();

    const screenshot = await screen.findByAltText("Pinned screenshot");

    expect(screenshot.style.borderRadius).toBe("8px");
  });

  it("marks the pinned screenshot as the frozen layer for blur sampling", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    const screenshot = await screen.findByAltText("Pinned screenshot");

    expect(screenshot.hasAttribute("data-frozen-layer")).toBe(true);
    expect(screenshot.getAttribute("crossorigin")).toBe("anonymous");
  });

  it("uses the accent variable for the pinned screenshot glow", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    const screenshot = await screen.findByAltText("Pinned screenshot");

    expect(screenshot.style.boxShadow).toContain("rgba(var(--flashot-accent-rgb), 0.5)");
  });

  it("applies radius from the query string to screenshot and annotation layers", async () => {
    window.location.hash = "#/pin/test-id?annotation=1&radius=8";

    renderPin();

    const screenshot = await screen.findByAltText("Pinned screenshot");
    const annotation = await screen.findByAltText("Pinned annotations");

    expect(screenshot.style.borderRadius).toBe("8px");
    expect(annotation.style.borderRadius).toBe("8px");
  });

  it("clamps oversized radius values", async () => {
    window.location.hash = "#/pin/test-id?radius=999";

    renderPin();

    const screenshot = await screen.findByAltText("Pinned screenshot");

    expect(screenshot.style.borderRadius).toBe("60px");
  });

  it("defaults invalid radius values to zero", async () => {
    window.location.hash = "#/pin/test-id?radius=bad";

    renderPin();

    const screenshot = await screen.findByAltText("Pinned screenshot");

    expect(screenshot.style.borderRadius).toBe("0px");
  });

  it("reveals the visual layer after the screenshot image is ready", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    const screenshot = await screen.findByAltText("Pinned screenshot");
    const stack = await screen.findByTestId("pin-image-stack");
    expect(stack.getAttribute("style")).toContain("opacity: 0");

    fireEvent.load(screenshot);

    await waitFor(() => {
      expect(stack.getAttribute("style")).toContain("opacity: 1");
    });
  });


  it("shows hover pin controls with fine-grained scale options", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    const root = await screen.findByTestId("pin-root");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

    await showControls(root);

    expect(screen.getByRole("button", { name: "Edit (E)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Image adjustments" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Scale: 100% (Ctrl 0/+/-)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close (Esc)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save As (Cmd+S)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy (Cmd+C)" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Scale: 100% (Ctrl 0/+/-)" }));

    const options = screen.getByTestId("pin-scale-options");
    expect(within(options).getByRole("button", { name: "Scale: 50%" })).not.toBeNull();
    expect(within(options).getByRole("button", { name: "Scale: 55%" })).not.toBeNull();
    expect(within(options).getByRole("button", { name: "Scale: 300%" })).not.toBeNull();
    expect(within(options).queryByRole("button", { name: "Scale: 305%" })).toBeNull();

    fireEvent.click(within(options).getByRole("button", { name: "Scale: 155%" }));

    await waitFor(() => {
      expect(setPinScale).toHaveBeenCalledWith("test-id", 1.55);
    });
  });

  it("keeps buttons usable across the native window gap without a palette mouseenter", async () => {
    window.location.hash = "#/pin/test-id";
    renderPin();
    const root = await screen.findByTestId("pin-root");
    await showControls(root);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.mocked(pinInteractionContainsCursor).mockResolvedValue(true);
    fireEvent.mouseLeave(root);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(pinInteractionContainsCursor).toHaveBeenCalledWith("test-id");
    fireEvent.click(screen.getByRole("button", { name: "Scale: 100% (Ctrl 0/+/-)" }));
    expect(screen.getByTestId("pin-scale-options")).not.toBeNull();
    // The pointer can also leave the palette without a DOM mouseleave event.
    vi.mocked(pinInteractionContainsCursor).mockResolvedValue(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(screen.queryByTestId("pin-controls")).toBeNull();
  });

  it("does not hide after a stale cursor check when the palette enter arrives late", async () => {
    window.location.hash = "#/pin/test-id";
    renderPin();
    const root = await screen.findByTestId("pin-root");
    const controls = await showControls(root);
    const palette = controls.closest("[data-pin-tool-window]")!;
    let resolve!: (inside: boolean) => void;
    vi.mocked(pinInteractionContainsCursor).mockImplementationOnce(() => new Promise<boolean>(r => { resolve = r; }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.mouseLeave(root);
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    fireEvent.mouseEnter(palette);
    await act(async () => { resolve(false); });
    expect(screen.getByTestId("pin-controls")).not.toBeNull();
    vi.mocked(pinInteractionContainsCursor).mockResolvedValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(screen.getByTestId("pin-controls")).not.toBeNull();
  });

  it("ignores stale palette hover state once the cursor is outside the whole pin group", async () => {
    window.location.hash = "#/pin/test-id";
    renderPin();
    const root = await screen.findByTestId("pin-root");
    const controls = await showControls(root);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.mouseLeave(root);
    fireEvent.mouseEnter(controls.closest("[data-pin-tool-window]")!);
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(screen.queryByTestId("pin-controls")).toBeNull();
  });

  it("keeps controls available during a failed cursor check and retries", async () => {
    window.location.hash = "#/pin/test-id";
    renderPin();
    const root = await screen.findByTestId("pin-root");
    await showControls(root);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.mocked(pinInteractionContainsCursor).mockRejectedValueOnce(new Error("native check delayed"));
    fireEvent.mouseLeave(root);
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(screen.getByTestId("pin-controls")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(screen.queryByTestId("pin-controls")).toBeNull();
  });

  it("keeps controls in a separate palette instead of image padding", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));

    const controls = screen.getByTestId("pin-controls");
    expect(controls.closest("[data-pin-tool-window=controls]")).not.toBeNull();
  });

  it("renders pin controls in Traditional Chinese", async () => {
    vi.mocked(getSettings).mockResolvedValue({ accentColor: "#0EA5E9", language: "zh-TW", theme: "system" } as any);
    window.location.hash = "#/pin/test-id";

    renderPin();

    const root = await screen.findByTestId("pin-root");
    await showControls(root);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "編輯 (E)" })).not.toBeNull();
    });
    expect(screen.getByRole("button", { name: "比例：100% (Ctrl 0/+/-)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "關閉 (Esc)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "另存新檔 (Cmd+S)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "複製 (Cmd+C)" })).not.toBeNull();
  });

  it("closes the pin from the hover toolbar", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Close (Esc)" }));

    await waitFor(() => {
      expect(closePin).toHaveBeenCalledWith("test-id");
    });
  });

  it("does not start a window drag on a plain click", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    const root = await screen.findByTestId("pin-root");
    webviewWindowMock.startDragging.mockClear();

    fireEvent.mouseDown(root, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 100, clientY: 100 });

    expect(webviewWindowMock.startDragging).not.toHaveBeenCalled();
  });

  it("starts a native window drag once the pointer moves past the threshold", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    const root = await screen.findByTestId("pin-root");
    webviewWindowMock.startDragging.mockClear();

    fireEvent.mouseDown(root, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 110, clientY: 100, buttons: 1 });

    await waitFor(() => {
      expect(webviewWindowMock.startDragging).toHaveBeenCalledTimes(1);
    });
  });

  it("clears a pending drag when the mouse button was released outside the webview", async () => {
    window.location.hash = "#/pin/test-id";
    renderPin();
    const root = await screen.findByTestId("pin-root");
    webviewWindowMock.startDragging.mockClear();
    fireEvent.mouseDown(root, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { buttons: 0, clientX: 110, clientY: 100 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 120, clientY: 100 });
    expect(webviewWindowMock.startDragging).not.toHaveBeenCalled();
    fireEvent.mouseDown(root, { button: 0, clientX: 120, clientY: 100 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 125, clientY: 100 });
    expect(webviewWindowMock.startDragging).toHaveBeenCalledTimes(1);
  });

  it("enters in-place edit mode with the annotation stage and toolbar", async () => {
    window.location.hash = "#/pin/test-id?annotation=1";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit (E)" }));

    // Annotation components are lazy-loaded; await their first paint.
    const stage = await screen.findByTestId("pin-annotation-stage");
    const toolbar = await screen.findByTestId("pin-annotation-toolbar");
    expect(stage).not.toBeNull();
    expect(toolbar).not.toBeNull();
    expect(toolbar.getAttribute("data-opaque-surface")).toBe("true");
    expect(screen.getByAltText("Pinned screenshot")).not.toBeNull();
    expect(screen.getByAltText("Pinned annotations")).not.toBeNull();
  });

  it("uses the device pixel ratio as a floor for pin annotation stage rendering", async () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    window.location.hash = "#/pin/test-id";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit (E)" }));

    expect(annotationStageMock).toHaveBeenLastCalledWith(expect.objectContaining({
      scaleFactor: 2,
    }));
  });

  it("uses the visual annotation scale when exporting edited pin annotations", async () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    window.location.hash = "#/pin/test-id";
    const annotationPng = new Uint8Array([1, 2, 3]).buffer;
    vi.mocked(exportAnnotationLayer).mockResolvedValue(annotationPng);

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    const editButton = screen.getByRole("button", { name: "Edit (E)" });
    fireEvent.click(editButton);
    fireEvent.click(editButton);

    await waitFor(() => {
      expect(exportAnnotationLayer).toHaveBeenCalledWith(2);
    });
  });

  it("uses a square pen icon for pin edit", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));

    expect(screen.getByRole("button", { name: "Edit (E)" }).querySelector(".lucide-square-pen")).not.toBeNull();
  });

  it("opens image adjustment controls and previews pin adjustments", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    const screenshot = await screen.findByAltText("Pinned screenshot");

    fireEvent.click(screen.getByRole("button", { name: "Image adjustments" }));

    expect(screen.getByTestId("image-adjustments-panel")).not.toBeNull();

    fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), { target: { value: "25" } });
    fireEvent.change(screen.getByRole("slider", { name: "Contrast" }), { target: { value: "-10" } });
    fireEvent.change(screen.getByRole("slider", { name: "Saturation" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Grayscale" }));

    expect(useOverlay.getState().imageAdjustments).toEqual({
      grayscale: true,
      brightness: 25,
      contrast: -10,
      saturation: 30,
    });
    expect(screenshot.style.filter).toContain("#preview-image-adjustments-filter");
    const matrix = document.querySelector("#preview-image-adjustments-filter feColorMatrix")!.getAttribute("values")!.split(" ").map(Number);
    expect(matrix[0]).toBeCloseTo(0.299 * 0.9);
    expect(matrix[4]).toBeCloseTo(0.9 * 0.25 + (128 / 255) * 0.1);
  });

  it("toggles pin edit mode off when the edit button is clicked again", async () => {
    window.location.hash = "#/pin/test-id";
    const annotationPng = new Uint8Array([1, 2, 3]).buffer;
    vi.mocked(exportAnnotationLayer).mockResolvedValue(annotationPng);

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    const editButton = screen.getByRole("button", { name: "Edit (E)" });

    fireEvent.click(editButton);
    expect(await screen.findByTestId("pin-annotation-stage")).not.toBeNull();
    expect(await screen.findByTestId("pin-annotation-toolbar")).not.toBeNull();

    fireEvent.click(editButton);

    await waitFor(() => {
      expect(screen.queryByTestId("pin-annotation-stage")).toBeNull();
      expect(screen.queryByTestId("pin-annotation-toolbar")).toBeNull();
    });
    expect(updatePinAnnotation).toHaveBeenCalledWith("test-id", annotationPng);
  });

  it("hosts a narrow pin's editor toolbar in its own floating palette", async () => {
    window.location.hash = "#/pin/test-id";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 340 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 260 });

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit (E)" }));

    const toolbar = await screen.findByTestId("pin-annotation-toolbar");
    expect(toolbar.getAttribute("data-placement")).toBe("floating");
    expect(toolbar.closest("[data-pin-tool-window=editor]")).not.toBeNull();
    expect(screen.getByTestId("pin-root").contains(toolbar)).toBe(false);
    expect(annotationStageMock).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { x: 0, y: 0, width: 340, height: 260 } }));
  });

  it("saves edited pin annotations over the same pin", async () => {
    window.location.hash = "#/pin/test-id";
    const annotationPng = new Uint8Array([4, 5, 6]).buffer;
    vi.mocked(exportAnnotationLayer).mockResolvedValue(annotationPng);

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit (E)" }));
    fireEvent.click(screen.getByRole("button", { name: "Save As (Cmd+S)" }));

    await waitFor(() => {
      expect(exportAnnotationLayer).toHaveBeenCalled();
      expect(updatePinAnnotation).toHaveBeenCalledWith("test-id", annotationPng);
    });
  });

  it("saves the current pin composition from the hover toolbar", async () => {
    window.location.hash = "#/pin/test-id?annotation=1";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Save As (Cmd+S)" }));

    await waitFor(() => {
      expect(savePin).toHaveBeenCalledWith("test-id", undefined);
    });
  });

  it("passes live pin image adjustments when saving and copying", async () => {
    window.location.hash = "#/pin/test-id";
    const adjustments = { grayscale: true, brightness: 18, contrast: -12, saturation: 30 };
    useOverlay.getState().setImageAdjustments(adjustments);

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Save As (Cmd+S)" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy (Cmd+C)" }));

    await waitFor(() => {
      expect(savePin).toHaveBeenCalledWith("test-id", undefined, adjustments);
      expect(copyPin).toHaveBeenCalledWith("test-id", undefined, adjustments);
    });
  });

  it("copies the current edited pin composition", async () => {
    window.location.hash = "#/pin/test-id";
    const annotationPng = new Uint8Array([9, 8, 7]).buffer;
    vi.mocked(exportAnnotationLayer).mockResolvedValue(annotationPng);

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit (E)" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy (Cmd+C)" }));

    await waitFor(() => {
      expect(copyPin).toHaveBeenCalledWith("test-id", annotationPng);
    });
  });

  it("briefly switches the copy button icon to a check after copying", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const copy = screen.getByRole("button", { name: "Copy (Cmd+C)" });

    expect(copy.querySelector(".lucide-copy")).not.toBeNull();
    fireEvent.click(copy);
    await act(async () => {
      await Promise.resolve();
    });

    expect(copyPin).toHaveBeenCalledWith("test-id", undefined);
    expect(copy.querySelector(".lucide-check")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(copy.querySelector(".lucide-copy")).not.toBeNull();
  });

  it("uses adaptive custom tooltips for pin controls", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    const copy = screen.getByRole("button", { name: "Copy (Cmd+C)" });
    expect(copy.getAttribute("title")).toBeNull();

    fireEvent.mouseEnter(copy);

    expect(screen.getByRole("tooltip").textContent).toBe("Copy (Cmd+C)");
  });

  it("keeps the image window free of control gutters", async () => {
    window.location.hash = "#/pin/test-id";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 340 });
    Object.defineProperty(window, "screenX", { configurable: true, value: 100 });
    Object.defineProperty(window.screen, "availLeft", { configurable: true, value: 0 });
    Object.defineProperty(window.screen, "availWidth", { configurable: true, value: 800 });

    renderPin();

    const root = await screen.findByTestId("pin-root");
    await showControls(root);
    const controls = screen.getByTestId("pin-controls");
    expect(controls.getAttribute("data-pin-controls-side")).toBe("right");
    expect(screen.getByTestId("pin-root").contains(controls)).toBe(false);
    expect(controls.closest("[data-pin-tool-window=controls]")).not.toBeNull();
    expect(root.style.paddingLeft).toBe("0px");
    expect(root.style.paddingRight).toBe("0px");
    expect(root.style.paddingBottom).toBe("0px");

    Object.defineProperty(window, "screenX", { configurable: true, value: 520 });
    await showControls(root);

    expect(screen.getByTestId("pin-controls").getAttribute("data-pin-controls-side")).toBe("right");
  });

  it("supports keyboard shortcuts for pin edit, save, and copy actions", async () => {
    window.location.hash = "#/pin/test-id";
    vi.mocked(exportAnnotationLayer).mockResolvedValue(null);

    renderPin();

    await screen.findByAltText("Pinned screenshot");

    fireEvent.keyDown(window, { key: "e" });
    expect(await screen.findByTestId("pin-annotation-stage")).not.toBeNull();

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => {
      expect(savePin).toHaveBeenCalledWith("test-id", undefined);
    });

    fireEvent.keyDown(window, { key: "c", metaKey: true });
    await waitFor(() => {
      expect(copyPin).toHaveBeenCalledWith("test-id", undefined);
    });
  });

  it("exits edit mode with Escape and saves edited annotations without closing the pin", async () => {
    window.location.hash = "#/pin/test-id";
    const annotationPng = new Uint8Array([7, 8, 9]).buffer;
    vi.mocked(exportAnnotationLayer).mockResolvedValue(annotationPng);

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit (E)" }));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("pin-annotation-stage")).toBeNull();
    });
    expect(updatePinAnnotation).toHaveBeenCalledWith("test-id", annotationPng);
    expect(closePin).not.toHaveBeenCalled();
  });

  it("maps normalized wheel notches to one 5 percent scale step", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await screen.findByAltText("Pinned screenshot");

    fireEvent.wheel(window, { deltaY: -20, deltaMode: 0 });
    expect(setPinScale).not.toHaveBeenCalled();

    fireEvent.wheel(window, { deltaY: -80, deltaMode: 0 });

    await waitFor(() => {
      expect(setPinScale).toHaveBeenCalledWith("test-id", 1.05);
    });

    vi.mocked(setPinScale).mockClear();

    fireEvent.wheel(window, { deltaY: -1000, deltaMode: 0 });

    await waitFor(() => {
      expect(setPinScale).toHaveBeenCalledTimes(1);
      expect(setPinScale).toHaveBeenCalledWith("test-id", 1.1);
    });
  });

  it("shows a temporary accented scale badge at the top of the pin while resizing", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await screen.findByAltText("Pinned screenshot");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    fireEvent.wheel(window, { deltaY: -100, deltaMode: 0 });

    const badge = screen.getByRole("status", { name: "Pin scale 105%" });
    expect(badge.textContent).toBe("105%");
    expect(badge.style.left).toBe("8px");
    expect(badge.style.top).toBe("8px");
    expect(badge.style.transform).toBe("");
    expect(badge.style.color).toBe("var(--flashot-accent)");
    expect(badge.style.background).toBe("rgba(18, 18, 18, 0.72)");

    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.queryByRole("status", { name: "Pin scale 105%" })).toBeNull();
  });

  it("uses an opaque screenshot-style surface for the pin controls", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));

    const controls = screen.getByTestId("pin-controls");
    expect(controls.style.background).toBe("rgb(30, 30, 30)");
    expect(controls.style.boxShadow).toBe("none");
    expect(controls.style.borderWidth).toBe("1px");
    expect(controls.style.borderStyle).toBe("solid");
    expect(controls.style.borderColor).toBe("rgba(255, 255, 255, 0.1)");
  });

  it("does not resize the pin while scrolling inside the scale menu", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await showControls(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Scale: 100% (Ctrl 0/+/-)" }));

    fireEvent.wheel(screen.getByTestId("pin-scale-options"), { deltaY: -120, deltaMode: 0 });

    expect(setPinScale).not.toHaveBeenCalled();
  });

  it("does not own native window visibility from the hidden webview", async () => {
    window.location.hash = "#/pin/test-id";

    renderPin();

    await screen.findByAltText("Pinned screenshot");

    expect(webviewWindowMock.show).not.toHaveBeenCalled();
  });

  it("waits for the annotation layer before revealing the visual layer", async () => {
    window.location.hash = "#/pin/test-id?annotation=1";

    renderPin();

    const screenshot = await screen.findByAltText("Pinned screenshot");
    const annotation = await screen.findByAltText("Pinned annotations");
    const stack = await screen.findByTestId("pin-image-stack");

    fireEvent.load(screenshot);
    expect(stack.getAttribute("style")).toContain("opacity: 0");

    fireEvent.load(annotation);

    await waitFor(() => {
      expect(stack.getAttribute("style")).toContain("opacity: 1");
    });
  });
});
