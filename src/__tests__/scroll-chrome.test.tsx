/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrollPin, stopScrollSession } from "@/lib/ipc";
import { ScrollChromeRoute } from "@/routes/ScrollChrome";

vi.mock("@/lib/ipc", () => ({
  getSettings: vi.fn().mockResolvedValue({
    language: "en",
    theme: "system",
    accentColor: "#4ED1FF",
  }),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
  onScrollProgress: vi.fn().mockResolvedValue(vi.fn()),
  scrollPin: vi.fn().mockResolvedValue("pin-1"),
  scrollCopy: vi.fn().mockResolvedValue(undefined),
  scrollSave: vi.fn().mockResolvedValue(null),
  stopScrollSession: vi.fn().mockResolvedValue({ width: 300, height: 1200, frameCount: 4 }),
}));

describe("ScrollChromeRoute", () => {
  beforeEach(() => {
    window.location.hash = "#/scroll-chrome/1";
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("pins directly when the user clicks Done", async () => {
    render(<ScrollChromeRoute />);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(scrollPin).toHaveBeenCalledTimes(1);
    });
    expect(stopScrollSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: "完成" })).toBeInTheDocument();
    });
    expect(screen.getByText("0 張影格 · 0px")).toBeInTheDocument();
  });

  it("matches the screenshot toolbar surface style", () => {
    const { container } = render(<ScrollChromeRoute />);
    const chrome = container.firstElementChild as HTMLElement;

    expect(chrome.style.borderRadius).toBe("10px");
    expect(chrome.style.background).toBe("rgba(30, 30, 30, 0.85)");
    expect(chrome.style.boxShadow).toBe("none");
  });
});
