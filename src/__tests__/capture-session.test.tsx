/** @vitest-environment jsdom */
import { currentCursorPointInWindow } from "@/lib/cursor";
import { getSettings, startScrollSession } from "@/lib/ipc";
import type { CaptureStartPayload } from "@/lib/types";
import { useOverlay } from "@/overlay/state";

import { OverlayRoute } from "@/routes/Overlay";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const ipcListeners = vi.hoisted(() => ({
  captureStart: undefined as undefined | ((payload: CaptureStartPayload) => void),
  captureRevealed: undefined as undefined | ((revision: string) => void),
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
  onCaptureRevealed: vi.fn((cb: (revision: string) => void) => {
    ipcListeners.captureRevealed = cb;
    return Promise.resolve(vi.fn());
  }),
  onCaptureStart: vi.fn((cb: (payload: CaptureStartPayload) => void) => {
    ipcListeners.captureStart = cb;
    return Promise.resolve(vi.fn());
  }),
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
  pushCaptureCursorMacos: vi.fn().mockResolvedValue(undefined),
  requestColorCopy: vi.fn().mockResolvedValue(undefined),
  requestColorFormatToggle: vi.fn().mockResolvedValue(undefined),
  releaseSelection: vi.fn().mockResolvedValue(undefined),
  setCaptureCursorMacos: vi.fn().mockResolvedValue(undefined),
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
  sessionMode: "capture",
  monitorId: 1,
  frameRevision: "revision-1",
  frameUrl: "asset://localhost//Users/dp/Library/Caches/dev.flashot.app/frame_1.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
  cornerRadius: 0,
  toolbarTopInset: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSettings).mockResolvedValue({ accentColor: "#F59E0B", language: "en", theme: "system" } as any);
  vi.mocked(currentCursorPointInWindow).mockReturnValue(new Promise(() => { }));
  useOverlay.getState().end(); useOverlay.getState().start(capture); useOverlay.getState().revealCapture("revision-1");
});
afterEach(() => { cleanup(); vi.useRealTimers(); useOverlay.getState().end(); });
it("cancelling scroll startup prevents the delayed command from affecting the next session", async () => {
  vi.useFakeTimers();
  useOverlay.getState().commit({ x: 100, y: 120, width: 240, height: 160 });
  render(<OverlayRoute />);
  fireEvent.click(screen.getByRole("button", { name: "Scrolling screenshot" }));
  expect(useOverlay.getState().mode).toBe("scrollStarting");
  act(() => {
    useOverlay.getState().end();
    useOverlay.getState().start({ ...capture, frameRevision: "revision-2" });
    useOverlay.getState().revealCapture("revision-2");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(startScrollSession).not.toHaveBeenCalled();
});
