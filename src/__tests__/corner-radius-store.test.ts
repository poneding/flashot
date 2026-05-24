import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __resetCornerRadiusPersistenceForTests, useOverlay } from "@/overlay/state";

vi.mock("@/lib/ipc", () => ({
  setSettings: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({
    captureHotkey: "",
    fullscreenHotkey: "",
    activeWindowHotkey: "",
    theme: "system",
    launchAtLogin: false,
    lastSaveDir: null,
    cornerRadius: 0,
  }),
}));

import { setSettings, getSettings } from "@/lib/ipc";

describe("overlay store corner radius", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    __resetCornerRadiusPersistenceForTests();
    useOverlay.setState({ cornerRadius: 0 });
  });
  afterEach(() => {
    __resetCornerRadiusPersistenceForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("setCornerRadius updates the store immediately", () => {
    useOverlay.getState().setCornerRadius(12);
    expect(useOverlay.getState().cornerRadius).toBe(12);
  });

  it("clamps values outside the 0..60 range", () => {
    useOverlay.getState().setCornerRadius(-5);
    expect(useOverlay.getState().cornerRadius).toBe(0);
    useOverlay.getState().setCornerRadius(100);
    expect(useOverlay.getState().cornerRadius).toBe(60);
  });

  it("coalesces rapid changes into a single debounced setSettings call", async () => {
    (getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      captureHotkey: "",
      fullscreenHotkey: "",
      activeWindowHotkey: "",
      theme: "system" as const,
      launchAtLogin: false,
      lastSaveDir: null,
      cornerRadius: 0,
    });

    useOverlay.getState().setCornerRadius(4);
    useOverlay.getState().setCornerRadius(8);
    useOverlay.getState().setCornerRadius(16);

    expect(setSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(160);
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ cornerRadius: 16 }),
    );
  });

  it("start() hydrates cornerRadius from the capture payload", () => {
    useOverlay.getState().start({
      monitorId: 0,
      monitorRect: { x: 0, y: 0, width: 100, height: 100 },
      scaleFactor: 1,
      frameUrl: "",
      windows: [],
      cornerRadius: 20,
    });
    expect(useOverlay.getState().cornerRadius).toBe(20);
  });

  it("start() normalizes cornerRadius from the capture payload", () => {
    useOverlay.getState().start({
      monitorId: 0,
      monitorRect: { x: 0, y: 0, width: 100, height: 100 },
      scaleFactor: 1,
      frameUrl: "",
      windows: [],
      cornerRadius: 99,
    });
    expect(useOverlay.getState().cornerRadius).toBe(60);

    useOverlay.getState().start({
      monitorId: 0,
      monitorRect: { x: 0, y: 0, width: 100, height: 100 },
      scaleFactor: 1,
      frameUrl: "",
      windows: [],
      cornerRadius: 12.6,
    });
    expect(useOverlay.getState().cornerRadius).toBe(13);
  });

  it("skips stale async persistence after a newer radius change", async () => {
    let resolveFirstSettings!: (value: Awaited<ReturnType<typeof getSettings>>) => void;
    const firstSettings = new Promise<Awaited<ReturnType<typeof getSettings>>>((resolve) => {
      resolveFirstSettings = resolve;
    });
    (getSettings as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(firstSettings)
      .mockResolvedValueOnce({
        captureHotkey: "",
        fullscreenHotkey: "",
        activeWindowHotkey: "",
        theme: "system" as const,
        launchAtLogin: false,
        lastSaveDir: null,
        cornerRadius: 0,
      });

    useOverlay.getState().setCornerRadius(10);
    await vi.advanceTimersByTimeAsync(160);
    expect(getSettings).toHaveBeenCalledTimes(1);

    useOverlay.getState().setCornerRadius(30);
    await vi.advanceTimersByTimeAsync(160);
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ cornerRadius: 30 }));

    resolveFirstSettings({
      captureHotkey: "",
      fullscreenHotkey: "",
      activeWindowHotkey: "",
      theme: "system" as const,
      launchAtLogin: false,
      lastSaveDir: null,
      cornerRadius: 0,
    });
    await vi.waitFor(() => expect(getSettings).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).not.toHaveBeenCalledWith(expect.objectContaining({ cornerRadius: 10 }));
  });
});
