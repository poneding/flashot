/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrollProgress } from "@/lib/types";
import { getSettings, onScrollProgress, scrollPin, stopScrollSession } from "@/lib/ipc";
import {
  SCREENSHOT_TOOLBAR_BACKGROUND,
  SCREENSHOT_TOOLBAR_BORDER,
  SCREENSHOT_TOOLBAR_RADIUS,
} from "@/overlay/Toolbar";
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

  it("renders a square translucent preview panel with an accent border and no action buttons", () => {
    const { container } = render(<ScrollChromeRoute />);
    const chrome = container.firstElementChild as HTMLElement;

    expect(chrome.style.borderRadius).toBe("0px");
    expect(chrome.style.background).toBe("rgba(24, 24, 24, 0.62)");
    expect(chrome.style.border).toContain("var(--flashot-accent-rgb)");
    expect(chrome.style.boxShadow).toBe("0 12px 36px rgba(0,0,0,0.34)");
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(scrollPin).not.toHaveBeenCalled();
    expect(stopScrollSession).not.toHaveBeenCalled();
  });

  it("uses screenshot toolbar styling for scroll labels and buttons", async () => {
    render(<ScrollChromeRoute />);

    await waitFor(() => {
      expect(onScrollProgress).toHaveBeenCalledTimes(1);
      expect(scrollProgressListener.current).toBeDefined();
    });
    act(() => {
      scrollProgressListener.current?.({
        frames: 1,
        height: 280,
        previewDataUrl: "data:image/png;base64,next",
        lastScore: 0.96,
      });
    });

    const status = screen.getByText("1 frames · 280px");
    const button = screen.getByRole("button", { name: "Finish scrolling screenshot" });
    const toolbarBorder = document.createElement("div");
    toolbarBorder.style.border = SCREENSHOT_TOOLBAR_BORDER;
    for (const element of [status, button]) {
      expect(element.style.background).toBe(SCREENSHOT_TOOLBAR_BACKGROUND);
      expect(element.style.border).toBe(toolbarBorder.style.border);
      expect(element.style.borderRadius).toBe(`${SCREENSHOT_TOOLBAR_RADIUS}px`);
    }
  });

  it("shows a compact finish check in the preview panel only after scrolling is accepted", async () => {
    render(<ScrollChromeRoute />);

    await waitFor(() => {
      expect(onScrollProgress).toHaveBeenCalledTimes(1);
      expect(scrollProgressListener.current).toBeDefined();
    });
    act(() => {
      scrollProgressListener.current?.({
        frames: 0,
        height: 160,
        previewDataUrl: "data:image/png;base64,initial",
        lastScore: 1,
      });
    });

    expect(screen.queryByRole("button", { name: "Finish scrolling screenshot" })).toBeNull();

    act(() => {
      scrollProgressListener.current?.({
        frames: 1,
        height: 280,
        previewDataUrl: "data:image/png;base64,next",
        lastScore: 0.96,
      });
    });

    const button = screen.getByRole("button", { name: "Finish scrolling screenshot" });
    expect(button.style.width).toBe("30px");
    expect(button.style.height).toBe("30px");
    expect(button.style.color).not.toContain("rgba");

    fireEvent.click(button);

    await waitFor(() => {
      expect(scrollPin).toHaveBeenCalledTimes(1);
    });
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
    const preview = screen.getByAltText("");
    expect(preview).toHaveAttribute("src", "data:image/png;base64,abc");
    expect(preview).toHaveAttribute("data-scroll-preview-height", "1280");
    expect(preview.style.bottom).toBe("0px");
    expect(preview.style.height).toBe("auto");
  });
});
