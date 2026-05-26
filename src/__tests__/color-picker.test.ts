/** @vitest-environment jsdom */
import { clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ColorPicker, colorPickerPosition, formatColorText } from "@/overlay/ColorPicker";
import { useOverlay } from "@/overlay/state";
import type { CaptureStartPayload } from "@/lib/types";

const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost/frame.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
  cornerRadius: 0,
};

describe("ColorPicker format conversion", () => {
  beforeEach(() => {
    mockConvertFileSrc("macos");
  });

  afterEach(() => {
    cleanup();
    clearMocks();
    useOverlay.getState().end();
  });

  it("converts RGB to HEX format", () => {
    const color = { r: 255, g: 90, b: 46 };
    expect(formatColorText(color, "hex")).toBe("#FF5A2E");
  });

  it("converts RGB to RGB string format", () => {
    const color = { r: 255, g: 90, b: 46 };
    expect(formatColorText(color, "rgb")).toBe("rgb(255,90,46)");
  });

  it("handles black color", () => {
    const color = { r: 0, g: 0, b: 0 };
    expect(formatColorText(color, "hex")).toBe("#000000");
    expect(formatColorText(color, "rgb")).toBe("rgb(0,0,0)");
  });

  it("handles white color", () => {
    const color = { r: 255, g: 255, b: 255 };
    expect(formatColorText(color, "hex")).toBe("#FFFFFF");
    expect(formatColorText(color, "rgb")).toBe("rgb(255,255,255)");
  });

  it("computes the picker position before rendering so it does not flash at the origin", () => {
    expect(colorPickerPosition({ x: 180, y: 180 }, capture.monitorRect)).toEqual({
      x: 200,
      y: 200,
    });
  });

  it("keeps the picker inside the monitor near screen edges", () => {
    expect(colorPickerPosition({ x: 790, y: 10 }, capture.monitorRect)).toEqual({
      x: 612,
      y: 30,
    });
  });

  it("stays hidden after a region is committed until explicitly enabled", () => {
    useOverlay.getState().start(capture);
    useOverlay.getState().commit({ x: 100, y: 100, width: 240, height: 160 });
    useOverlay.getState().setCursor({ x: 180, y: 180 });

    const { container, rerender } = render(createElement(ColorPicker));

    expect(container.querySelector("canvas")).toBeNull();

    act(() => {
      useOverlay.getState().toggleColorPicker();
    });
    rerender(createElement(ColorPicker));

    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("renders the picker panel above annotation elements", () => {
    useOverlay.getState().start(capture);
    useOverlay.getState().commit({ x: 100, y: 100, width: 240, height: 160 });
    useOverlay.getState().setCursor({ x: 180, y: 180 });
    useOverlay.getState().toggleColorPicker();

    const { container } = render(createElement(ColorPicker));
    const panel = container.firstElementChild as HTMLElement | null;

    expect(Number(panel?.style.zIndex)).toBeGreaterThan(10002);
  });
});
