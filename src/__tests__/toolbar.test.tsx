/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "@/overlay/Toolbar";
import { __resetCornerRadiusPersistenceForTests, useOverlay } from "@/overlay/state";
import { useAnnotation } from "@/annotation/store";
import type { CaptureStartPayload } from "@/lib/types";

vi.mock("@/lib/ipc", () => ({
  cropAndCopy: vi.fn(),
  cropAndSave: vi.fn(),
  cancelCapture: vi.fn(),
  pinImage: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}));

const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost/frame.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
  cornerRadius: 0,
};

describe("Toolbar", () => {
  const onCopy = vi.fn();
  const onSave = vi.fn();
  const onPin = vi.fn();
  const onClose = vi.fn();
  const onScroll = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAnnotation.getState().reset();
    useAnnotation.getState().setActiveTool("rect");
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
    useOverlay.getState().commit({ x: 100, y: 100, width: 240, height: 160 });
  });

  afterEach(() => {
    __resetCornerRadiusPersistenceForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
    cleanup();
  });

  function renderToolbar() {
    return render(
      <Toolbar
        selection={{ x: 100, y: 100, width: 240, height: 160 }}
        monitorRect={{ x: 0, y: 0, width: 800, height: 600 }}
        onCopy={onCopy}
        onSave={onSave}
        onPin={onPin}
        onClose={onClose}
        onScroll={onScroll}
      />,
    );
  }

  it("renders screenshot actions in a vertical toolbar with a top drag handle", () => {
    const { container } = renderToolbar();

    const copy = screen.getByRole("button", { name: "Copy" });
    const save = screen.getByRole("button", { name: "Save As" });
    const pin = screen.getByRole("button", { name: "Pin" });
    const close = screen.getByRole("button", { name: "Close" });
    const toolbar = container.querySelector("[data-screenshot-toolbar]") as HTMLElement | null;
    const handle = container.querySelector("[data-screenshot-toolbar-drag-handle]") as HTMLElement | null;

    expect(toolbar).not.toBeNull();
    expect(handle).not.toBeNull();
    expect(toolbar?.firstElementChild).toBe(handle);
    expect(toolbar?.style.flexDirection).toBe("column");
    expect(toolbar?.style.height).toBe("");
    expect(copy.textContent).toBe("");
    expect(save.textContent).toBe("");
    expect(pin.textContent).toBe("");
    expect(close.textContent).toBe("");
    expect(copy.getAttribute("title")).toBeNull();
    expect(save.getAttribute("title")).toBeNull();
    expect(pin.getAttribute("title")).toBeNull();
    expect(close.getAttribute("title")).toBeNull();
    expect(screen.queryByText("Copy")).toBeNull();

    fireEvent.mouseEnter(copy);

    expect(screen.getByRole("tooltip").textContent).toBe("Copy");
  });

  it("groups pin, color picker, and scrolling screenshot above the close action", () => {
    const { container } = renderToolbar();
    const radiusGroup = container.querySelector('[data-screenshot-toolbar-group="radius"]');
    const pinScrollGroup = container.querySelector('[data-screenshot-toolbar-group="pin-scroll"]');
    const closeGroup = container.querySelector('[data-screenshot-toolbar-group="close"]');

    expect(radiusGroup).not.toBeNull();
    expect(pinScrollGroup).not.toBeNull();
    expect(closeGroup).not.toBeNull();
    expect(radiusGroup?.querySelector('[aria-label="Corner radius: 0 px"]')).not.toBeNull();
    expect(pinScrollGroup?.querySelector('[aria-label="Pin"]')).not.toBeNull();
    expect(pinScrollGroup?.querySelector('[aria-label="Color Picker"]')).not.toBeNull();
    expect(pinScrollGroup?.querySelector('[aria-label="Image adjustments"]')).not.toBeNull();
    expect(pinScrollGroup?.querySelector('[aria-label="Scrolling screenshot"]')).not.toBeNull();
    expect(closeGroup?.querySelector('[aria-label="Close"]')).not.toBeNull();

    const groups = Array.from(container.querySelectorAll("[data-screenshot-toolbar-group]"));
    const groupButtons = Array.from(pinScrollGroup!.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(groups[0]).toBe(radiusGroup);
    expect(groups.indexOf(radiusGroup as Element)).toBeLessThan(groups.indexOf(pinScrollGroup as Element));
    expect(groups.indexOf(pinScrollGroup as Element)).toBeLessThan(groups.indexOf(closeGroup as Element));
    expect(groupButtons).toEqual([
      "Pin",
      "Color Picker",
      "Image adjustments",
      "Scrolling screenshot",
    ]);
  });

  it("opens image adjustment controls and updates overlay adjustments", () => {
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "Image adjustments" }));

    expect(screen.getByTestId("image-adjustments-panel")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Grayscale" }));
    fireEvent.click(screen.getByRole("button", { name: "Auto enhance" }));
    fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), { target: { value: "25" } });
    fireEvent.change(screen.getByRole("slider", { name: "Contrast" }), { target: { value: "-20" } });
    fireEvent.change(screen.getByRole("slider", { name: "Saturation" }), { target: { value: "35" } });
    fireEvent.change(screen.getByRole("slider", { name: "Sharpness" }), { target: { value: "40" } });

    expect(useOverlay.getState().imageAdjustments).toEqual({
      grayscale: true,
      autoLevels: true,
      brightness: 25,
      contrast: -20,
      saturation: 35,
      sharpness: 40,
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset image adjustments" }));

    expect(useOverlay.getState().imageAdjustments).toEqual({
      grayscale: false,
      autoLevels: false,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpness: 0,
    });
  });

  describe("Toolbar corner radius control", () => {
    it("renders the corner radius button as the first action after the drag handle", () => {
      const { container } = renderToolbar();
      const toolbar = container.querySelector("[data-screenshot-toolbar]") as HTMLElement;
      const handle = toolbar.children[0];
      const radiusGroup = container.querySelector('[data-screenshot-toolbar-group="radius"]');
      const pinScrollGroup = container.querySelector('[data-screenshot-toolbar-group="pin-scroll"]');
      const groups = Array.from(container.querySelectorAll("[data-screenshot-toolbar-group]"));

      expect(radiusGroup).not.toBeNull();
      expect(radiusGroup?.querySelector('[aria-label="Corner radius: 0 px"]')).not.toBeNull();
      expect(groups[0]).toBe(radiusGroup);
      expect(groups[1]).toBe(pinScrollGroup);
      expect(handle.hasAttribute("data-screenshot-toolbar-drag-handle")).toBe(true);
      expect(handle.nextElementSibling).toBe(radiusGroup);
    });

    it("uses the Lucide square-round-corner icon", () => {
      renderToolbar();

      const icon = screen
        .getByRole("button", { name: "Corner radius: 0 px" })
        .querySelector("svg");

      expect(icon?.classList.contains("lucide-square-round-corner")).toBe(true);
    });

    it("opens the scrollable corner radius panel when clicked", () => {
      renderToolbar();

      fireEvent.click(screen.getByRole("button", { name: "Corner radius: 0 px" }));

      const list = screen.getByTestId("screenshot-corner-radius-list");
      const panel = list.closest("[data-corner-radius-panel]") as HTMLElement;
      expect(screen.queryByRole("combobox", { name: "Corner radius" })).toBeNull();
      expect(panel.style.width).toBe("72px");
      expect(panel.style.padding).toBe("4px");
      expect(list.className).toContain("flashot-dark-scrollbar");
      expect(within(list).getByRole("button", { name: "Corner radius: 0 px" })).not.toBeNull();
      expect(within(list).getByRole("button", { name: "Corner radius: 1 px" })).not.toBeNull();
      expect(within(list).getByRole("button", { name: "Corner radius: 60 px" })).not.toBeNull();
    });

    it("closes the slider panel when clicked again", () => {
      renderToolbar();

      const button = screen.getByRole("button", { name: "Corner radius: 0 px" });
      fireEvent.click(button);
      fireEvent.mouseDown(button);
      fireEvent.click(button);

      expect(screen.queryByRole("button", { name: "Corner radius: 24 px" })).toBeNull();
    });

    it("closes the slider panel even if timers run between button mousedown and click", () => {
      vi.useFakeTimers();
      renderToolbar();

      const button = screen.getByRole("button", { name: "Corner radius: 0 px" });
      fireEvent.click(button);
      fireEvent.mouseDown(button);
      act(() => vi.runOnlyPendingTimers());
      fireEvent.click(button);

      expect(screen.queryByRole("button", { name: "Corner radius: 24 px" })).toBeNull();
    });

    it("updates the overlay corner radius from the dropdown", () => {
      renderToolbar();

      fireEvent.click(screen.getByRole("button", { name: "Corner radius: 0 px" }));
      fireEvent.click(screen.getByRole("button", { name: "Corner radius: 16 px" }));

      expect(useOverlay.getState().cornerRadius).toBe(16);
      expect(screen.getByRole("button", { name: "Corner radius: 16 px" })).not.toBeNull();
    });
  });

  it("toggles the color picker below pin and returns annotation tools to select", () => {
    renderToolbar();

    expect(useOverlay.getState().colorPickerVisible).toBe(false);
    expect(useAnnotation.getState().activeTool).toBe("rect");

    fireEvent.click(screen.getByRole("button", { name: "Color Picker" }));

    expect(useOverlay.getState().colorPickerVisible).toBe(true);
    expect(useAnnotation.getState().activeTool).toBe("select");

    fireEvent.click(screen.getByRole("button", { name: "Color Picker" }));

    expect(useOverlay.getState().colorPickerVisible).toBe(false);
  });

  it("uses a vertical chevrons ellipsis icon for scrolling screenshot", () => {
    renderToolbar();

    const icon = screen
      .getByRole("button", { name: "Scrolling screenshot" })
      .querySelector("svg");
    const paths = Array.from(icon?.querySelectorAll("path") ?? []).map((path) =>
      path.getAttribute("d"),
    );

    expect(icon?.getAttribute("data-scroll-screenshot-icon")).toBe("vertical");
    expect(paths).toEqual(
      expect.arrayContaining([
        "M12 8h.01",
        "M12 12h.01",
        "M12 16h.01",
        "m7 7 5-5 5 5",
        "m7 17 5 5 5-5",
      ]),
    );
  });

  it("defaults to the right side of the selection", () => {
    const { container } = renderToolbar();
    const toolbar = container.querySelector("[data-screenshot-toolbar]") as HTMLElement;

    expect(toolbar.style.left).toBe("344px");
    expect(toolbar.style.top).toBe("100px");
  });

  it("keeps the toolbar inside monitor bounds while dragging", () => {
    const { container } = renderToolbar();
    const handle = container.querySelector("[data-screenshot-toolbar-drag-handle]") as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 350, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 900, clientY: 800 });
    fireEvent.mouseUp(document);

    const toolbar = container.querySelector("[data-screenshot-toolbar]") as HTMLElement;
    expect(toolbar.style.left).toBe("760px");
    expect(toolbar.style.top).toBe("292px");
  });

  it("routes output actions through the provided callbacks", async () => {
    renderToolbar();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    });
    expect(onPin).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save As" }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(onCopy).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
