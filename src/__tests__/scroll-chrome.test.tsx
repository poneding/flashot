/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrollProgress } from "@/lib/types";
import { getSettings, onScrollProgress, scrollPin, stopScrollSession } from "@/lib/ipc";
import { ScrollChromeRoute } from "@/routes/ScrollChrome";

const scrollProgressListener = vi.hoisted(() => ({
  current: undefined as undefined | ((p: ScrollProgress) => void),
}));

vi.mock("@/lib/ipc", () => ({
  getSettings: vi.fn().mockResolvedValue({
    language: "en",
    theme: "system",
    accentColor: "#4ED1FF",
  }),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
  onScrollProgress: vi.fn((cb: (p: ScrollProgress) => void) => {
    scrollProgressListener.current = cb;
    return Promise.resolve(vi.fn());
  }),
  scrollPin: vi.fn().mockResolvedValue("pin-1"),
  scrollCopy: vi.fn().mockResolvedValue(undefined),
  scrollSave: vi.fn().mockResolvedValue(null),
  stopScrollSession: vi.fn().mockResolvedValue({ width: 300, height: 1200, frameCount: 4 }),
}));

describe("ScrollChromeRoute", () => {
  beforeEach(() => {
    window.location.hash = "#/scroll-chrome/1";
    scrollProgressListener.current = undefined;
    vi.clearAllMocks();
    vi.mocked(getSettings).mockResolvedValue({
      language: "en",
      theme: "system",
      accentColor: "#4ED1FF",
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a translucent preview panel without action buttons", () => {
    const { container } = render(<ScrollChromeRoute />);
    const chrome = container.firstElementChild as HTMLElement;

    expect(chrome.style.borderRadius).toBe("10px");
    expect(chrome.style.background).toBe("rgba(24, 24, 24, 0.62)");
    expect(chrome.style.boxShadow).toBe("0 12px 36px rgba(0,0,0,0.34)");
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(scrollPin).not.toHaveBeenCalled();
    expect(stopScrollSession).not.toHaveBeenCalled();
  });

  it("renders localized scroll status in Traditional Chinese", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      language: "zh-TW",
      theme: "system",
      accentColor: "#4ED1FF",
    } as any);

    render(<ScrollChromeRoute />);

    await waitFor(() => {
      expect(screen.getByText("0 張影格 · 0px")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "完成" })).not.toBeInTheDocument();
  });

  it("floats progress status at the bottom center over the preview", async () => {
    render(<ScrollChromeRoute />);

    await waitFor(() => {
      expect(onScrollProgress).toHaveBeenCalledTimes(1);
      expect(scrollProgressListener.current).toBeDefined();
    });
    act(() => {
      scrollProgressListener.current?.({
        frames: 4,
        height: 1280,
        previewDataUrl: "data:image/png;base64,abc",
        lastScore: 0.95,
      });
    });

    const status = screen.getByText("4 frames · 1280px");
    expect(status).toHaveAttribute("data-scroll-status-pill");
    expect(status.style.position).toBe("absolute");
    expect(status.style.left).toBe("50%");
    expect(status.style.bottom).toBe("12px");
    expect(screen.getByAltText("")).toHaveAttribute("src", "data:image/png;base64,abc");
  });
});
