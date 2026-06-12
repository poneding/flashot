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
  cornerRadius: 0,
};

const selectedRect: AnnotationObject = {
  id: "rect-1",
  type: "rect",
  start: { x: 10, y: 20 },
  end: { x: 120, y: 90 },
  style: { color: "#0099ff", strokeWidth: 4, fill: "hollow" },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
};

function renderToolbar(props: Partial<React.ComponentProps<typeof Toolbar>> = {}) {
  return render(<Toolbar selection={selection} monitorRect={monitorRect} {...props} />);
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

    fireEvent.click(screen.getByLabelText("#33cc33"));

    const object = useAnnotation.getState().objects.find((o) => o.id === selectedRect.id);
    expect(object?.style.color).toBe("#33cc33");
    expect(useAnnotation.getState().activeStyle.color).toBe("#33cc33");
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

  it("can render an opaque toolbar surface for pin windows", () => {
    const { container } = renderToolbar({ opaqueSurface: true });

    const toolbar = container.querySelector("[data-annotation-toolbar]") as HTMLElement;

    expect(toolbar.style.background).toBe("rgb(30, 30, 30)");
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
      "Measure",
      "Arrow",
      "Rectangle",
      "Ellipse",
      "Text",
      "Blur",
      "Highlight",
      "Spotlight",
      "Marker",
      "Magnifier",
      "Eraser",
      "Undo (Cmd+Z)",
      "Redo (Cmd+Shift+Z)",
    ].forEach((title) => {
      const button = screen.getByRole("button", { name: title });
      expect(button).not.toBeNull();
      expect(button.getAttribute("title")).toBeNull();
    });
  });

  it("renders annotation tool labels in Simplified Chinese", () => {
    renderToolbar({ locale: "zh-CN" });

    expect(screen.getByRole("button", { name: "矩形" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "测量" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "撤销 (Cmd+Z)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "重做 (Cmd+Shift+Z)" })).not.toBeNull();
  });

  it("places measure immediately after eraser and omits the color picker", () => {
    const { container } = renderToolbar();
    const toolbar = container.querySelector("[data-annotation-toolbar]") as HTMLElement;
    const labels = Array.from(toolbar.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label"),
    );

    expect(labels.indexOf("Measure")).toBe(labels.indexOf("Eraser") + 1);
    expect(labels).not.toContain("Color Picker");
  });

  it("selects the measure tool from the toolbar", () => {
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "Measure" }));

    expect(useAnnotation.getState().activeTool).toBe("measure");
  });

  it("selects the marker tool from the toolbar", () => {
    useAnnotation.getState().setCurrentMarkerNumber(8);
    renderToolbar();

    const markerButton = screen.getByRole("button", { name: "Marker" });
    const markerIcon = markerButton.querySelector("svg") as SVGSVGElement | null;

    expect(markerIcon?.getAttribute("width")).toBe("20");
    const markerCircle = markerIcon?.querySelector("circle");
    const markerText = markerIcon?.querySelector("text");
    expect(markerCircle?.getAttribute("r")).toBe("10");
    expect(markerCircle?.getAttribute("fill")).toBe("none");
    expect(markerCircle?.getAttribute("stroke")).toBe("currentColor");
    expect(markerText?.getAttribute("fill")).toBe("currentColor");
    expect(markerText?.textContent).toBe("8");

    fireEvent.click(markerButton);

    expect(useAnnotation.getState().activeTool).toBe("marker");
  });

  it("selects the magnifier tool from the toolbar", () => {
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "Magnifier" }));

    expect(useAnnotation.getState().activeTool).toBe("magnifier");
  });

  it("selects the standalone spotlight tool with the Lightbulb icon", () => {
    renderToolbar();

    const spotlightButton = screen.getByRole("button", { name: "Spotlight" });
    expect(spotlightButton.querySelector(".lucide-lightbulb")).not.toBeNull();

    fireEvent.click(spotlightButton);

    expect(useAnnotation.getState().activeTool).toBe("spotlight");
    expect(useAnnotation.getState().activeStyle.fill).toBe("spotlight");
  });

  it("closes the color picker when another annotation tool is selected", () => {
    renderToolbar();

    useOverlay.setState({ colorPickerVisible: true });

    fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));

    expect(useOverlay.getState().colorPickerVisible).toBe(false);
  });

  it("toggles an active annotation tool back to move mode on the second click", () => {
    renderToolbar();
    const rectangle = screen.getByRole("button", { name: "Rectangle" });

    fireEvent.click(rectangle);

    expect(useAnnotation.getState().activeTool).toBe("rect");
    const activeIndicator = rectangle.querySelector("span") as HTMLElement | null;
    expect(activeIndicator).not.toBeNull();
    expect(activeIndicator?.style.background).toBe("var(--flashot-accent)");

    fireEvent.click(rectangle);

    expect(useAnnotation.getState().activeTool).toBe("select");
    expect(rectangle.querySelector("span")).toBeNull();
  });

  it("does not render screenshot output actions", () => {
    renderToolbar();

    expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy (Cmd+C)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save (Cmd+S)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel (ESC)" })).toBeNull();
  });

  it("shows an immediate custom tooltip for undo", () => {
    renderToolbar();
    const undo = screen.getByRole("button", { name: "Undo (Cmd+Z)" });

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
      if (el.getAttribute("aria-label") === "Redo (Cmd+Shift+Z)") {
        return domRect({ top: 124, left: 390, width: 32, height: 32 });
      }
      return domRect();
    });
    renderToolbar();
    const redo = screen.getByRole("button", { name: "Redo (Cmd+Shift+Z)" });

    fireEvent.mouseEnter(redo);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.style.top).toBe("116px");
    expect(tooltip.style.bottom).toBe("");
  });

  it("flips top tooltips below the toolbar when the toolbar is near the viewport edge", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const el = this;
      if (el.hasAttribute("data-annotation-toolbar")) {
        return domRect({ top: 2, left: 80, width: 420, height: 40 });
      }
      if (el.getAttribute("aria-label") === "Undo (Cmd+Z)") {
        return domRect({ top: 6, left: 320, width: 32, height: 32 });
      }
      return domRect();
    });

    renderToolbar();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Undo (Cmd+Z)" }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.style.top).toBe("46px");
    expect(tooltip.style.transform).toBe("translateX(-50%)");
  });

  it("renders toolbar tooltips outside the filtered toolbar surface", () => {
    renderToolbar();
    const undo = screen.getByRole("button", { name: "Undo (Cmd+Z)" });

    fireEvent.mouseEnter(undo);

    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
  });

  it("uses control-key shortcuts on non-mac platforms", () => {
    setNavigatorPlatform("Win32");

    renderToolbar();

    expect(screen.getByRole("button", { name: "Undo (Ctrl+Z)" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" })).not.toBeNull();
  });

  it("shows undo and redo tooltips even when unavailable", () => {
    renderToolbar();
    const undo = screen.getByRole("button", { name: "Undo (Cmd+Z)" });

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
