/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopScrollSession } from "@/lib/ipc";
import { ScrollChromeRoute } from "@/routes/ScrollChrome";
import type { ScrollEndReason } from "@/lib/types";

const scrollListeners = vi.hoisted(() => ({
  endDetected: undefined as undefined | ((reason: ScrollEndReason) => void),
}));

vi.mock("@/lib/ipc", () => ({
  onScrollProgress: vi.fn().mockResolvedValue(vi.fn()),
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
    vi.clearAllMocks();
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

  it("matches the screenshot toolbar surface style", () => {
    const { container } = render(<ScrollChromeRoute />);
    const chrome = container.firstElementChild as HTMLElement;

    expect(chrome.style.borderRadius).toBe("10px");
    expect(chrome.style.background).toBe("rgba(30, 30, 30, 0.85)");
    expect(chrome.style.boxShadow).toBe("none");
  });
});
