/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PinRoute } from "@/routes/Pin";

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

vi.mock("@/lib/ipc", () => ({
  closePin: vi.fn().mockResolvedValue(undefined),
  setPinScale: vi.fn().mockResolvedValue(undefined),
}));

describe("PinRoute", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.location.hash = "";
  });

  it("layers exported annotations over the pinned screenshot when present", async () => {
    window.location.hash = "#/pin/test-id?annotation=1";

    render(<PinRoute />);

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

    render(<PinRoute />);

    await waitFor(() => {
      expect(screen.getByAltText("Pinned screenshot")).not.toBeNull();
    });
    expect(screen.queryByAltText("Pinned annotations")).toBeNull();
  });

  it("reveals the visual layer after the screenshot image is ready", async () => {
    window.location.hash = "#/pin/test-id";

    render(<PinRoute />);

    const screenshot = await screen.findByAltText("Pinned screenshot");
    const stack = await screen.findByTestId("pin-image-stack");
    expect(stack.getAttribute("style")).toContain("opacity: 0");

    fireEvent.load(screenshot);

    await waitFor(() => {
      expect(stack.getAttribute("style")).toContain("opacity: 1");
    });
  });

  it("waits for the annotation layer before revealing the visual layer", async () => {
    window.location.hash = "#/pin/test-id?annotation=1";

    render(<PinRoute />);

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
