/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrozenLayer } from "@/overlay/FrozenLayer";
import { useOverlay } from "@/overlay/state";
import type { CaptureStartPayload } from "@/lib/types";

const capture: CaptureStartPayload = {
  monitorId: 3,
  frameUrl: "asset://localhost//Users/dp/Library/Caches/dev.flashot.app/frame_3.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
  cornerRadius: 0,
};

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe("FrozenLayer", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockConvertFileSrc("macos");
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
    });
    createObjectURLMock = vi.fn().mockReturnValue("blob:flashot-frame");
    revokeObjectURLMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURLMock,
    });
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
  });

  afterEach(() => {
    cleanup();
    clearMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
    useOverlay.getState().end();
  });

  it("loads legacy asset urls through releasable blob sources", async () => {
    const { container } = render(<FrozenLayer />);

    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:flashot-frame");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "asset://localhost/%2FUsers%2Fdp%2FLibrary%2FCaches%2Fdev.flashot.app%2Fframe_3.png",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("revokes blob sources when the frozen layer unmounts", async () => {
    const { container, unmount } = render(<FrozenLayer />);

    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:flashot-frame");
    });
    unmount();

    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:flashot-frame");
  });

  it("applies image adjustment previews through an adjusted overlay layer", async () => {
    useOverlay.getState().setImageAdjustments({
      grayscale: true,
      brightness: 25,
      contrast: -20,
      saturation: 35,
    });

    const { container } = render(<FrozenLayer />);

    await waitFor(() => {
      expect(container.querySelector<HTMLImageElement>("img[data-frozen-layer]")).not.toBeNull();
    });
    const baseImage = container.querySelector<HTMLImageElement>("img[data-frozen-layer]");
    const previewImage = container.querySelector("svg[data-adjusted-frozen-layer] image");

    expect(baseImage?.style.filter).toBe("");
    expect(previewImage?.getAttribute("href")).toBe(baseImage?.getAttribute("src"));
    expect(previewImage?.getAttribute("filter")).toBe("url(#preview-image-adjustments-filter)");
    expect(container.querySelector("feColorMatrix")).not.toBeNull();
    expect(container.querySelector("feComponentTransfer")).not.toBeNull();
    expect(container.querySelector("feConvolveMatrix")).toBeNull();
  });

  it("limits the adjusted preview layer to the committed selection", async () => {
    const selection = { x: 100, y: 120, width: 240, height: 160 };
    useOverlay.getState().commit(selection);
    useOverlay.getState().setImageAdjustments({ brightness: 40 });

    const { container } = render(<FrozenLayer />);

    await waitFor(() => {
      expect(container.querySelector("svg[data-adjusted-frozen-layer]")).not.toBeNull();
    });
    const preview = container.querySelector<SVGSVGElement>("svg[data-adjusted-frozen-layer]");
    const image = preview?.querySelector("image");
    const filter = preview?.querySelector("filter");

    expect(preview?.style.left).toBe("100px");
    expect(preview?.style.top).toBe("120px");
    expect(preview?.style.width).toBe("240px");
    expect(preview?.style.height).toBe("160px");
    expect(preview?.getAttribute("viewBox")).toBe("0 0 240 160");
    expect(image?.getAttribute("x")).toBe("-100");
    expect(image?.getAttribute("y")).toBe("-120");
    expect(image?.getAttribute("width")).toBe("800");
    expect(image?.getAttribute("height")).toBe("600");
    expect(filter?.getAttribute("filterUnits")).toBe("userSpaceOnUse");
    expect(filter?.getAttribute("x")).toBe("0");
    expect(filter?.getAttribute("y")).toBe("0");
    expect(filter?.getAttribute("width")).toBe("240");
    expect(filter?.getAttribute("height")).toBe("160");
  });
});
