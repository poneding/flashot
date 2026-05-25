/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("FrozenLayer", () => {
  beforeEach(() => {
    mockConvertFileSrc("macos");
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
  });

  afterEach(() => {
    cleanup();
    clearMocks();
    useOverlay.getState().end();
  });

  it("converts legacy asset urls into webview-loadable frame sources", () => {
    const { container } = render(<FrozenLayer />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "asset://localhost/%2FUsers%2Fdp%2FLibrary%2FCaches%2Fdev.flashot.app%2Fframe_3.png",
    );
  });
});
