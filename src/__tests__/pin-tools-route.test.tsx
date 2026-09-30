/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PinToolsRoute } from "@/routes/PinTools";
import { DEFAULT_STYLE } from "@/annotation/types";
import { useAnnotation } from "@/annotation/store";
import { getPinToolsState, sendPinAction, startPinDrag } from "@/lib/ipc";
import type { PinToolsEnvelope } from "@/pin/types";

const bus = vi.hoisted(() => ({ listener: null as ((state: PinToolsEnvelope) => void) | null }));
vi.mock("@/lib/ipc", () => ({
  getSettings: vi.fn().mockResolvedValue({ accentColor: "#0EA5E9", language: "en", theme: "system" }),
  onSettingsChanged: vi.fn().mockResolvedValue(() => {}),
  getPinToolsState: vi.fn(),
  onPinToolsState: vi.fn().mockImplementation(async callback => { bus.listener = callback; return () => { bus.listener = null; }; }),
  onPinToolsPlacement: vi.fn().mockResolvedValue(() => {}),
  resizePinToolWindow: vi.fn().mockResolvedValue({ side: "right" }),
  sendPinAction: vi.fn().mockResolvedValue(undefined),
  startPinDrag: vi.fn().mockResolvedValue(undefined),
}));

function snapshot(revision = 1): PinToolsEnvelope {
  return { pinId: "one", revision, state: {
    visible: true, editing: false, scale: 1, copyConfirmed: false, locale: "en",
    imageAdjustments: { brightness: 0, contrast: 0, saturation: 0, grayscale: false },
    annotation: { activeTool: "select", activeStyle: DEFAULT_STYLE, objects: [], selectedObjectId: null, currentMarkerNumber: 1, canUndo: false, canRedo: false },
  } };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAnnotation.getState().reset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
  vi.mocked(getPinToolsState).mockResolvedValue(snapshot());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ""; });

describe("owned pin palettes", () => {
  it("drags the owner from transparent palette space but keeps buttons interactive", async () => {
    window.location.hash = "#/pin-tools/one/controls";
    render(<PinToolsRoute />);
    const copy = await screen.findByRole("button", { name: "Copy (Cmd+C)" });
    const background = copy.closest("[data-pin-tool-window]")!;
    fireEvent.mouseDown(copy, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20, clientY: 20 });
    expect(startPinDrag).not.toHaveBeenCalled();
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(background, { button: 0, clientX: 100, clientY: 20 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 105, clientY: 20 });
    expect(startPinDrag).toHaveBeenCalledExactlyOnceWith("one");
  });

  it("dismisses a scale popup with Escape before closing its pin", async () => {
    window.location.hash = "#/pin-tools/one/controls";
    render(<PinToolsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Scale: 100% (Ctrl 0/+/-)" }));
    expect(screen.getByTestId("pin-scale-options")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("pin-scale-options")).toBeNull();
    expect(sendPinAction).not.toHaveBeenCalledWith("one", { type: "close" });
  });
  it("routes actions to its image and ignores other pins or older snapshots", async () => {
    window.location.hash = "#/pin-tools/one/controls";
    render(<PinToolsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy (Cmd+C)" }));
    expect(sendPinAction).toHaveBeenCalledWith("one", { type: "copy" });
    await act(async () => {
      const foreign = snapshot(99); foreign.pinId = "another"; foreign.state.scale = 2;
      bus.listener?.(foreign);
      const old = snapshot(0); old.state.scale = 3;
      bus.listener?.(old);
    });
    expect(screen.getByRole("button", { name: "Scale: 100% (Ctrl 0/+/-)" })).toBeTruthy();
    await act(async () => { const current = snapshot(2); current.state.scale = 1.5; bus.listener?.(current); });
    expect(screen.getByRole("button", { name: "Scale: 150% (Ctrl 0/+/-)" })).toBeTruthy();
  });

  it("sends toolbar and property edits to the image document instead of a local undo stack", async () => {
    window.location.hash = "#/pin-tools/one/editor";
    const initial = snapshot(); initial.state.editing = true;
    vi.mocked(getPinToolsState).mockResolvedValue(initial);
    render(<PinToolsRoute />);
    fireEvent.click(await screen.findByRole("button", { name: "Pen" }));
    expect(sendPinAction).toHaveBeenCalledWith("one", { type: "tool", tool: "draw" });
    expect(useAnnotation.getState().activeTool).toBe("select");
    await act(async () => {
      const next = snapshot(2); next.state.editing = true; next.state.annotation.activeTool = "draw";
      bus.listener?.(next);
    });
    fireEvent.click(await screen.findByRole("button", { name: "#0099ff" }));
    expect(sendPinAction).toHaveBeenCalledWith("one", {
      type: "style", tool: "draw", selectedObjectId: null, updates: { color: "#0099ff" },
    });
    expect(useAnnotation.getState().canUndo).toBe(false);
  });
});
