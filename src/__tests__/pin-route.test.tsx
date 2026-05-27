/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportAnnotationLayer } from "@/annotation/export";
import { PinRoute } from "@/routes/Pin";
import { closePin, copyPin, setPinScale, updatePinAnnotation } from "@/lib/ipc";

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

vi.mock("@/annotation/Stage", () => ({
  AnnotationStage: vi.fn(() => <div data-testid="pin-annotation-stage" />),
}));

vi.mock("@/annotation/Toolbar", () => ({
  Toolbar: vi.fn(() => <div data-testid="pin-annotation-toolbar" />),
}));

vi.mock("@/annotation/export", () => ({
  exportAnnotationLayer: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ipc", () => ({
  closePin: vi.fn().mockResolvedValue(undefined),
  copyPin: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({ accentColor: "#0EA5E9" }),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
  setPinScale: vi.fn().mockResolvedValue(undefined),
  updatePinAnnotation: vi.fn().mockResolvedValue(undefined),
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

  it("applies radius from the query string to the screenshot layer", async () => {
    window.location.hash = "#/pin/test-id?radius=8";

    render(<PinRoute />);

    const screenshot = await screen.findByAltText("Pinned screenshot");

    expect(screenshot.style.borderRadius).toBe("8px");
  });

  it("uses the accent variable for the pinned screenshot glow", async () => {
    window.location.hash = "#/pin/test-id";

    render(<PinRoute />);

    const screenshot = await screen.findByAltText("Pinned screenshot");

    expect(screenshot.style.boxShadow).toContain("rgba(var(--flashot-accent-rgb), 0.5)");
  });

  it("applies radius from the query string to screenshot and annotation layers", async () => {
    window.location.hash = "#/pin/test-id?annotation=1&radius=8";

    render(<PinRoute />);

    const screenshot = await screen.findByAltText("Pinned screenshot");
    const annotation = await screen.findByAltText("Pinned annotations");

    expect(screenshot.style.borderRadius).toBe("8px");
    expect(annotation.style.borderRadius).toBe("8px");
  });

  it("clamps oversized radius values", async () => {
    window.location.hash = "#/pin/test-id?radius=999";

    render(<PinRoute />);

    const screenshot = await screen.findByAltText("Pinned screenshot");

    expect(screenshot.style.borderRadius).toBe("60px");
  });

  it("defaults invalid radius values to zero", async () => {
    window.location.hash = "#/pin/test-id?radius=bad";

    render(<PinRoute />);

    const screenshot = await screen.findByAltText("Pinned screenshot");

    expect(screenshot.style.borderRadius).toBe("0px");
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


  it("shows hover pin controls with fine-grained scale options", async () => {
    window.location.hash = "#/pin/test-id";

    render(<PinRoute />);

    const root = await screen.findByTestId("pin-root");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

    fireEvent.mouseEnter(root);

    expect(screen.getByRole("button", { name: "Edit" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Scale: 100%" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Scale: 100%" }));

    const options = screen.getByTestId("pin-scale-options");
    expect(within(options).getByRole("button", { name: "Scale: 50%" })).not.toBeNull();
    expect(within(options).getByRole("button", { name: "Scale: 55%" })).not.toBeNull();
    expect(within(options).getByRole("button", { name: "Scale: 300%" })).not.toBeNull();
    expect(within(options).queryByRole("button", { name: "Scale: 305%" })).toBeNull();

    fireEvent.click(within(options).getByRole("button", { name: "Scale: 155%" }));

    await waitFor(() => {
      expect(setPinScale).toHaveBeenCalledWith("test-id", 1.55);
    });
  });

  it("closes the pin from the hover toolbar", async () => {
    window.location.hash = "#/pin/test-id";

    render(<PinRoute />);

    fireEvent.mouseEnter(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(closePin).toHaveBeenCalledWith("test-id");
    });
  });

  it("enters in-place edit mode with the annotation stage and toolbar", async () => {
    window.location.hash = "#/pin/test-id?annotation=1";

    render(<PinRoute />);

    fireEvent.mouseEnter(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByTestId("pin-annotation-stage")).not.toBeNull();
    expect(screen.getByTestId("pin-annotation-toolbar")).not.toBeNull();
    expect(screen.getByAltText("Pinned screenshot")).not.toBeNull();
    expect(screen.getByAltText("Pinned annotations")).not.toBeNull();
  });

  it("saves edited pin annotations over the same pin", async () => {
    window.location.hash = "#/pin/test-id";
    const annotationPng = new Uint8Array([4, 5, 6]).buffer;
    vi.mocked(exportAnnotationLayer).mockResolvedValue(annotationPng);

    render(<PinRoute />);

    fireEvent.mouseEnter(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(exportAnnotationLayer).toHaveBeenCalled();
      expect(updatePinAnnotation).toHaveBeenCalledWith("test-id", annotationPng);
    });
  });

  it("copies the current edited pin composition", async () => {
    window.location.hash = "#/pin/test-id";
    const annotationPng = new Uint8Array([9, 8, 7]).buffer;
    vi.mocked(exportAnnotationLayer).mockResolvedValue(annotationPng);

    render(<PinRoute />);

    fireEvent.mouseEnter(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(copyPin).toHaveBeenCalledWith("test-id", annotationPng);
    });
  });

  it("cancels edit mode with Escape without closing or saving the pin", async () => {
    window.location.hash = "#/pin/test-id";

    render(<PinRoute />);

    fireEvent.mouseEnter(await screen.findByTestId("pin-root"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("pin-annotation-stage")).toBeNull();
    });
    expect(updatePinAnnotation).not.toHaveBeenCalled();
    expect(closePin).not.toHaveBeenCalled();
  });

  it("maps normalized wheel notches to one 5 percent scale step", async () => {
    window.location.hash = "#/pin/test-id";

    render(<PinRoute />);

    await screen.findByAltText("Pinned screenshot");

    fireEvent.wheel(window, { deltaY: -20, deltaMode: 0 });
    expect(setPinScale).not.toHaveBeenCalled();

    fireEvent.wheel(window, { deltaY: -80, deltaMode: 0 });

    await waitFor(() => {
      expect(setPinScale).toHaveBeenCalledWith("test-id", 1.05);
    });

    vi.mocked(setPinScale).mockClear();

    fireEvent.wheel(window, { deltaY: -1000, deltaMode: 0 });

    await waitFor(() => {
      expect(setPinScale).toHaveBeenCalledTimes(1);
      expect(setPinScale).toHaveBeenCalledWith("test-id", 1.1);
    });
  });

  it("does not own native window visibility from the hidden webview", async () => {
    window.location.hash = "#/pin/test-id";

    render(<PinRoute />);

    await screen.findByAltText("Pinned screenshot");

    expect(webviewWindowMock.show).not.toHaveBeenCalled();
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
