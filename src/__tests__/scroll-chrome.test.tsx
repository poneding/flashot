/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings, stopScrollSession } from "@/lib/ipc";
import { ScrollChromeRoute } from "@/routes/ScrollChrome";
import type { ScrollEndReason, ScrollProgress } from "@/lib/types";

const scrollListeners = vi.hoisted(() => ({
  endDetected: undefined as undefined | ((reason: ScrollEndReason) => void),
  progress: undefined as undefined | ((progress: ScrollProgress) => void),
}));

vi.mock("@/lib/ipc", () => ({
  getSettings: vi.fn().mockResolvedValue({
    language: "en",
    theme: "system",
    accentColor: "#4ED1FF",
  }),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
  onScrollProgress: vi.fn((cb: (progress: ScrollProgress) => void) => {
    scrollListeners.progress = cb;
    return Promise.resolve(vi.fn());
  }),
  onScrollMatchFailed: vi.fn().mockResolvedValue(vi.fn()),
  onScrollEndDetected: vi.fn((cb: (reason: ScrollEndReason) => void) => {
    scrollListeners.endDetected = cb;
    return Promise.resolve(vi.fn());
  }),
  scrollCopy: vi.fn().mockResolvedValue(undefined),
  scrollSave: vi.fn().mockResolvedValue(null),
  stopScrollSession: vi.fn().mockResolvedValue({ width: 300, height: 1200, frameCount: 4 }),
}));

describe("ScrollChromeRoute", () => {
  beforeEach(() => {
    window.location.hash = "#/scroll-chrome/1";
    scrollListeners.endDetected = undefined;
    scrollListeners.progress = undefined;
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

  it("does not finalize until the user clicks Done", async () => {
    render(<ScrollChromeRoute />);

    await waitFor(() => {
      expect(scrollListeners.endDetected).toBeDefined();
    });

    await act(async () => {
      scrollListeners.endDetected?.("bottom");
    });

    expect(stopScrollSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByText("Bottom reached")).toBeInTheDocument();
  });

  it("renders scroll status and actions in Traditional Chinese", async () => {
    const { getSettings } = await import("@/lib/ipc");
    vi.mocked(getSettings).mockResolvedValue({
      language: "zh-TW",
      theme: "system",
      accentColor: "#4ED1FF",
    } as any);

    render(<ScrollChromeRoute />);

    await waitFor(() => {
      expect(scrollListeners.endDetected).toBeDefined();
    });

    await act(async () => {
      scrollListeners.endDetected?.("bottom");
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "完成" })).toBeInTheDocument();
    });
    expect(screen.getByText("已到達底部")).toBeInTheDocument();
  });

  it("matches the screenshot toolbar surface style", () => {
    const { container } = render(<ScrollChromeRoute />);
    const chrome = container.firstElementChild as HTMLElement;

    expect(chrome.style.borderRadius).toBe("10px");
    expect(chrome.style.background).toBe("rgba(30, 30, 30, 0.85)");
    expect(chrome.style.boxShadow).toBe("none");
  });

  it("renders a live stitched preview from progress events", async () => {
    render(<ScrollChromeRoute />);

    await waitFor(() => {
      expect(scrollListeners.progress).toBeDefined();
    });

    await act(async () => {
      scrollListeners.progress?.({
        frames: 3,
        height: 960,
        previewDataUrl: "data:image/png;base64,preview",
        lastScore: 0.91,
      });
    });

    const preview = screen.getByTestId("scroll-chrome-preview-image") as HTMLImageElement;
    expect(preview.src).toContain("data:image/png;base64,preview");
    expect(screen.getByText("3 frames · 960px")).toBeInTheDocument();
  });

  it("keeps capture actions pinned to the bottom of the preview panel", () => {
    render(<ScrollChromeRoute />);

    const panel = screen.getByTestId("scroll-chrome-panel");
    const actions = screen.getByTestId("scroll-chrome-actions");

    expect(panel.style.flexDirection).toBe("column");
    expect(actions.style.marginTop).toBe("auto");
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
