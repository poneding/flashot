/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PinRoute } from "@/routes/Pin";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appCacheDir: vi.fn().mockResolvedValue("/cache"),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    startDragging: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/ipc", () => ({
  closePin: vi.fn().mockResolvedValue(undefined),
  setPinScale: vi.fn().mockResolvedValue(undefined),
}));

describe("PinRoute", () => {
  afterEach(() => {
    cleanup();
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
});
