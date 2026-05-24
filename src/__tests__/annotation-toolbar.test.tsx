/** @vitest-environment jsdom */
import { Toolbar } from "@/annotation/Toolbar";
import { useAnnotation } from "@/annotation/store";
import { useOverlay } from "@/overlay/state";
import type { AnnotationObject } from "@/annotation/types";
import type { CaptureStartPayload, Rect } from "@/lib/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selection: Rect = { x: 100, y: 120, width: 300, height: 180 };
const monitorRect: Rect = { x: 0, y: 0, width: 900, height: 700 };
const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost/frame.png",
  monitorRect,
  scaleFactor: 2,
  windows: [],
};

const selectedRect: AnnotationObject = {
  id: "rect-1",
  type: "rect",
  start: { x: 10, y: 20 },
  end: { x: 120, y: 90 },
  style: { color: "#0099ff", strokeWidth: 4, fill: "hollow" },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
};

function renderToolbar() {
  return render(<Toolbar selection={selection} monitorRect={monitorRect} />);
}

function propertyPanelElement(container: HTMLElement): HTMLElement {
  const panel = Array.from(container.querySelectorAll("div")).find(
    (el) => (el as HTMLElement).style.zIndex === "10001",
  ) as HTMLElement | undefined;
  expect(panel).toBeTruthy();
  return panel!;
}

function setNavigatorPlatform(platform: string) {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: platform,
  });
}

const defaultInnerHeight = window.innerHeight;

describe("Annotation toolbar", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: defaultInnerHeight });
    setNavigatorPlatform("MacIntel");
    useAnnotation.getState().reset();
    useAnnotation.getState().setActiveStyle({ color: "#ff0000", strokeWidth: 4 });
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
    useOverlay.getState().commit(selection);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useOverlay.getState().end();
  });

  it("automatically shows the selected object's property panel and edits that object", () => {
    useAnnotation.getState().addObject(selectedRect);
    useAnnotation.getState().setSelectedObject(selectedRect.id);

    renderToolbar();

    fireEvent.click(screen.getByTitle("#33cc33"));

    const object = useAnnotation.getState().objects.find((o) => o.id === selectedRect.id);
    expect(object?.style.color).toBe("#33cc33");
    expect(useAnnotation.getState().activeStyle.color).not.toBe("#33cc33");
  });

  it("removes the visible select tool and uses a dedicated drag handle", () => {
    const { container } = renderToolbar();

    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    const toolbar = container.querySelector("[data-annotation-toolbar]");
    expect(toolbar).not.toBeNull();

    const handle = container.querySelector("[data-annotation-toolbar-drag-handle]") as HTMLElement | null;
    expect(handle).not.toBeNull();
    expect(toolbar?.firstElementChild).toBe(handle);
    expect(handle!.getAttribute("style")).toContain("cursor: move");
    expect(screen.queryByTitle("Move toolbar")).toBeNull();
    expect(toolbar?.getAttribute("style")).not.toContain("cursor: move");
  });

  it("keeps the toolbar inside monitor bounds while dragging", () => {
    const { container } = renderToolbar();
    const handle = container.querySelector("[data-annotation-toolbar-drag-handle]") as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 110, clientY: 320 });
    fireEvent.mouseMove(document, { clientX: -200, clientY: -160 });
    fireEvent.mouseUp(document);

    const toolbar = container.querySelector("[data-annotation-toolbar]") as HTMLElement;
    expect(toolbar.style.left).toBe("0px");
    expect(toolbar.style.top).toBe("0px");
  });

  it("provides hover tooltips for toolbar operations", () => {
    renderToolbar();

    [
      "Pen",
      "Line",
      "Arrow",
      "Rectangle",
      "Ellipse",
      "Text",
      "Blur",
      "Highlight",
      "Eraser",
      "Color Picker",
      "Undo (Cmd+Z)",
      "Redo (Cmd+Shift+Z)",
    ].forEach((title) => {
      expect(screen.getByTitle(title)).not.toBeNull();
    });
  });

  it("toggles the committed color picker from the horizontal toolbar", () => {
    renderToolbar();

    expect(useOverlay.getState().colorPickerVisible).toBe(false);

    fireEvent.click(screen.getByTitle("Color Picker"));

    expect(useOverlay.getState().colorPickerVisible).toBe(true);

    fireEvent.click(screen.getByTitle("Color Picker"));

    expect(useOverlay.getState().colorPickerVisible).toBe(false);
  });

  it("closes the color picker when another annotation tool is selected", () => {
    renderToolbar();

    fireEvent.click(screen.getByTitle("Color Picker"));
    expect(useOverlay.getState().colorPickerVisible).toBe(true);

    fireEvent.click(screen.getByTitle("Rectangle"));

    expect(useOverlay.getState().colorPickerVisible).toBe(false);
  });

  it("turns off annotation tools when the color picker is enabled", () => {
    const { container } = renderToolbar();

    fireEvent.click(screen.getByTitle("Rectangle"));
    expect(useAnnotation.getState().activeTool).toBe("rect");
    expect(propertyPanelElement(container)).not.toBeNull();

    fireEvent.click(screen.getByTitle("Color Picker"));

    expect(useOverlay.getState().colorPickerVisible).toBe(true);
    expect(useAnnotation.getState().activeTool).toBe("select");
    expect(
      Array.from(container.querySelectorAll("div")).some(
        (el) => (el as HTMLElement).style.zIndex === "10001",
      ),
    ).toBe(false);
  });

  it("toggles an active annotation tool back to move mode on the second click", () => {
    renderToolbar();
    const rectangle = screen.getByTitle("Rectangle");

    fireEvent.click(rectangle);

    expect(useAnnotation.getState().activeTool).toBe("rect");
    expect(rectangle.querySelector("span")).not.toBeNull();

    fireEvent.click(rectangle);

    expect(useAnnotation.getState().activeTool).toBe("select");
    expect(rectangle.querySelector("span")).toBeNull();
  });

  it("does not render screenshot output actions", () => {
    renderToolbar();

    expect(screen.queryByTitle("Pin")).toBeNull();
    expect(screen.queryByTitle("Copy (Cmd+C)")).toBeNull();
    expect(screen.queryByTitle("Save (Cmd+S)")).toBeNull();
    expect(screen.queryByTitle("Cancel (ESC)")).toBeNull();
  });

  it("shows an immediate custom tooltip for undo", () => {
    renderToolbar();
    const undo = screen.getByTitle("Undo (Cmd+Z)");

    fireEvent.mouseEnter(undo);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("Undo (Cmd+Z)");
    expect(tooltip.getAttribute("style")).toContain("background: rgba(18, 18, 18, 0.72)");
    expect(undo.style.background).toBe("transparent");
  });

  it("positions toolbar tooltips from the toolbar edge", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const el = this;
      if (el.hasAttribute("data-annotation-toolbar")) {
        return domRect({ top: 120, left: 80, width: 420, height: 40 });
      }
      if (el.getAttribute("title") === "Redo (Cmd+Shift+Z)") {
        return domRect({ top: 124, left: 390, width: 32, height: 32 });
      }
      return domRect();
    });
    renderToolbar();
    const redo = screen.getByTitle("Redo (Cmd+Shift+Z)");

    fireEvent.mouseEnter(redo);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.style.top).toBe("116px");
    expect(tooltip.style.bottom).toBe("");
  });

  it("renders toolbar tooltips outside the filtered toolbar surface", () => {
    renderToolbar();
    const undo = screen.getByTitle("Undo (Cmd+Z)");

    fireEvent.mouseEnter(undo);

    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
  });

  it("uses control-key shortcuts on non-mac platforms", () => {
    setNavigatorPlatform("Win32");

    renderToolbar();

    expect(screen.getByTitle("Undo (Ctrl+Z)")).not.toBeNull();
    expect(screen.getByTitle("Redo (Ctrl+Shift+Z)")).not.toBeNull();
  });

  it("shows undo and redo tooltips even when unavailable", () => {
    renderToolbar();
    const undo = screen.getByTitle("Undo (Cmd+Z)");

    fireEvent.mouseEnter(undo);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("Undo (Cmd+Z)");
    expect(tooltip.getAttribute("style")).toContain("background: rgba(18, 18, 18, 0.72)");
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    expect(undo.style.opacity).toBe("");
  });

  it("keeps the property panel gap consistent above and below the toolbar", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(34);

    useAnnotation.getState().addObject(selectedRect);
    useAnnotation.getState().setSelectedObject(selectedRect.id);

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    const belowRender = renderToolbar();
    const belowToolbar = belowRender.container.querySelector("[data-annotation-toolbar]") as HTMLElement;
    const belowPanel = propertyPanelElement(belowRender.container);
    const belowToolbarBottom = parseFloat(belowToolbar.style.top) + parseFloat(belowToolbar.style.height);
    expect(parseFloat(belowPanel.style.top) - belowToolbarBottom).toBe(4);
    belowRender.unmount();

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 352 });
    const aboveRender = renderToolbar();
    const aboveToolbar = aboveRender.container.querySelector("[data-annotation-toolbar]") as HTMLElement;
    const abovePanel = propertyPanelElement(aboveRender.container);
    const aboveToolbarTop = parseFloat(aboveToolbar.style.top);
    const abovePanelBottom = parseFloat(abovePanel.style.top) + 34;
    expect(aboveToolbarTop - abovePanelBottom).toBe(4);
  });
});

function domRect(partial: Partial<DOMRect> = {}): DOMRect {
  const left = partial.left ?? 0;
  const top = partial.top ?? 0;
  const width = partial.width ?? 0;
  const height = partial.height ?? 0;
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: partial.right ?? left + width,
    bottom: partial.bottom ?? top + height,
    toJSON: () => { },
  } as DOMRect;
}
