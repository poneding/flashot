/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyPanel } from "@/annotation/PropertyPanel";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

vi.mock("@/lib/ipc", () => ({
  listSystemFonts: vi.fn().mockResolvedValue(["Arial", "Helvetica", "Times New Roman"]),
}));

const defaultInnerHeight = window.innerHeight;
const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

describe("Annotation property panel", () => {
  beforeEach(() => {
    localStorage.clear();
    useAnnotation.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreScrollIntoView();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: defaultInnerHeight });
  });

  it("renders dropdown icons as icons instead of raw text glyphs", () => {
    const { container, rerender } = render(<PropertyPanel tool="line" />);

    expect(screen.queryByText("━")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();

    rerender(<PropertyPanel tool="text" />);

    expect(screen.queryByText("✎")).toBeNull();
    expect(screen.queryByText("<>")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders compact option controls as icons instead of raw text glyphs", () => {
    const { container, rerender } = render(<PropertyPanel tool="rect" />);

    expect(screen.queryByText("□")).toBeNull();
    expect(screen.queryByText("■")).toBeNull();
    expect(screen.queryByText("┐")).toBeNull();
    expect(screen.queryByText("╮")).toBeNull();

    rerender(<PropertyPanel tool="highlight" />);

    expect(screen.queryByText("✎")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("uses matching filled shape icons for rectangle and ellipse fill options", () => {
    const { container, rerender } = render(<PropertyPanel tool="rect" />);

    const rectHollowIcon = fillOptionIcon(container, "Hollow");
    const rectFilledIcon = fillOptionIcon(container, "Filled");
    expect(rectHollowIcon.querySelector("rect")?.getAttribute("width")).toBe("18");
    expect(rectFilledIcon.querySelector("rect")?.getAttribute("width")).toBe("18");
    expect(rectFilledIcon.querySelector("rect")?.getAttribute("fill")).toBe("currentColor");

    rerender(<PropertyPanel tool="ellipse" />);

    const ellipseHollowIcon = fillOptionIcon(container, "Hollow");
    const ellipseFilledIcon = fillOptionIcon(container, "Filled");
    expect(ellipseHollowIcon.querySelector("circle")?.getAttribute("r")).toBe("10");
    expect(ellipseFilledIcon.querySelector("circle")?.getAttribute("r")).toBe("10");
    expect(ellipseFilledIcon.querySelector("circle")?.getAttribute("fill")).toBe("currentColor");
    expect(ellipseHollowIcon.querySelector("rect")).toBeNull();
    expect(ellipseFilledIcon.querySelector("rect")).toBeNull();
  });

  it("uses a dropdown corner radius control for rectangles", () => {
    render(<PropertyPanel tool="rect" />);

    expect(screen.queryByLabelText("Sharp corners")).toBeNull();
    expect(screen.queryByLabelText("Rounded corners")).toBeNull();
    expect(screen.getByRole("button", { name: "Corner radius: 0" })).not.toBeNull();
    expect(screen.getByText("0")).not.toBeNull();
    expect(screen.queryByText("0px")).toBeNull();
    expect(screen.queryByLabelText("Decrease Corner radius")).toBeNull();
    expect(screen.queryByLabelText("Increase Corner radius")).toBeNull();
  });

  it("keeps numeric control names in tooltips instead of visible labels", () => {
    render(<PropertyPanel tool="rect" />);

    expect(screen.queryByText("粗细")).toBeNull();
    expect(screen.queryByText("圆角")).toBeNull();
    expect(screen.queryByText("Stroke")).toBeNull();
    expect(screen.queryByText("Radius")).toBeNull();
    expect(screen.getByRole("button", { name: /^Stroke width:/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Corner radius: 0" })).not.toBeNull();
  });

  it("renders measurement controls without decorative line style choices", () => {
    render(<PropertyPanel tool="measure" />);

    expect(screen.getByRole("button", { name: /^Stroke width:/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Free angle" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Horizontal / vertical" })).not.toBeNull();
    expect(screen.getByLabelText("#ff0000")).not.toBeNull();
    expect(screen.queryByLabelText("Decrease Stroke width")).toBeNull();
    expect(screen.queryByLabelText("Increase Stroke width")).toBeNull();
    expect(screen.queryByLabelText("Line style: Solid")).toBeNull();
    expect(screen.queryByLabelText("Arrowhead: Open")).toBeNull();
  });

  it("updates the active measurement mode from the property panel", () => {
    useAnnotation.getState().setActiveTool("measure");
    render(<PropertyPanel tool="measure" />);

    fireEvent.click(screen.getByRole("button", { name: "Horizontal / vertical" }));

    expect(useAnnotation.getState().activeStyle.measureMode).toBe("axis");
  });

  it("axis-aligns a selected measurement around its midpoint from the property panel", () => {
    const measure: AnnotationObject = {
      id: "measure-1",
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      style: { color: "#ff0000", strokeWidth: 4, measureMode: "free" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    act(() => {
      useAnnotation.getState().addObject(measure);
      useAnnotation.getState().setSelectedObject(measure.id);
    });

    render(<PropertyPanel tool="measure" object={useAnnotation.getState().objects[0]} />);
    fireEvent.click(screen.getByRole("button", { name: "Horizontal / vertical" }));

    const next = useAnnotation.getState().objects[0];
    expect(next.style.measureMode).toBe("axis");
    expect(next.start?.x).toBeCloseTo(15);
    expect(next.start?.y).toBeCloseTo(-5);
    expect(next.end?.x).toBeCloseTo(15);
    expect(next.end?.y).toBeCloseTo(45);
  });

  it("renders highlight stroke and corner radius as dropdown controls", () => {
    render(<PropertyPanel tool="highlight" />);

    expect(screen.getByRole("button", { name: /^Stroke width:/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Corner radius: 0" })).not.toBeNull();
    expect(screen.queryByLabelText("Decrease Stroke width")).toBeNull();
    expect(screen.queryByLabelText("Increase Stroke width")).toBeNull();
    expect(screen.queryByLabelText("Decrease Corner radius")).toBeNull();
    expect(screen.queryByLabelText("Increase Corner radius")).toBeNull();
  });

  it("shows marker fill, font size, and next number controls", () => {
    useAnnotation.getState().setActiveTool("marker");
    useAnnotation.getState().setCurrentMarkerNumber(3);
    render(<PropertyPanel tool="marker" />);

    const fill = screen.getByLabelText("Marker fill");

    fireEvent.click(within(fill).getByRole("button", { name: "#0099ff" }));
    fireEvent.click(screen.getByLabelText("Increase Marker number"));
    fireEvent.change(screen.getByRole("textbox", { name: "Marker number" }), { target: { value: "12" } });

    expect(useAnnotation.getState().activeStyle.markerFill).toBe("#0099ff");
    expect(screen.getByRole("button", { name: "Font size: 14" })).not.toBeNull();
    expect(useAnnotation.getState().currentMarkerNumber).toBe(12);
    expect(screen.queryByLabelText("Marker text color")).toBeNull();
    expect(screen.queryByLabelText("Marker bubble background")).toBeNull();
  });

  it("disables marker number controls at the 0 and 99 bounds with boundary tooltips", () => {
    useAnnotation.getState().setActiveTool("marker");
    useAnnotation.getState().setCurrentMarkerNumber(99);
    const { rerender } = render(<PropertyPanel tool="marker" />);

    const increase = screen.getByRole("button", { name: "Increase Marker number" }) as HTMLButtonElement;
    expect(increase.disabled).toBe(true);
    fireEvent.mouseEnter(increase.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe("Already at maximum marker number");

    act(() => {
      useAnnotation.getState().setCurrentMarkerNumber(0);
    });
    rerender(<PropertyPanel tool="marker" />);

    const decrease = screen.getByRole("button", { name: "Decrease Marker number" }) as HTMLButtonElement;
    expect(decrease.disabled).toBe(true);
    fireEvent.mouseEnter(decrease.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe("Already at minimum marker number");
  });

  it("shows magnifier shape tabs and places zoom before rectangular corner radius", () => {
    render(<PropertyPanel tool="magnifier" />);

    const shapeTabs = screen.getByRole("tablist", { name: "Magnifier shape" });
    expect(within(shapeTabs).getByRole("tab", { name: "Circle" })).not.toBeNull();
    expect(within(shapeTabs).getByRole("tab", { name: "Rounded rectangle lens" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Magnifier shape: Circle" })).toBeNull();
    expect(screen.getByRole("button", { name: "Magnifier zoom: 200%" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Magnifier border width: 8" })).toBeNull();
    expect(screen.queryByLabelText("Magnifier border color")).toBeNull();
    expect(screen.queryByRole("button", { name: "Magnifier corner radius: 12" })).toBeNull();

    const rectangleOption = within(shapeTabs).getByRole("tab", { name: "Rounded rectangle lens" });
    const rectangleIcon = rectangleOption.querySelector("svg rect");
    expect(rectangleIcon?.getAttribute("y")).toBe("3");
    expect(rectangleIcon?.getAttribute("height")).toBe("18");
    fireEvent.click(rectangleOption);
    expect(useAnnotation.getState().activeStyle.magnifierShape).toBe("rounded-rect");
    const zoomButton = screen.getByRole("button", { name: "Magnifier zoom: 200%" });
    const radiusButton = screen.getByRole("button", { name: "Magnifier corner radius: 12" });
    expect(zoomButton.compareDocumentPosition(radiusButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(radiusButton);
    const radiusList = screen.getByTestId("annotation-number-list-magnifier-corner-radius");
    fireEvent.click(within(radiusList).getByRole("button", { name: "Magnifier corner radius: 24" }));
    expect(useAnnotation.getState().activeStyle.magnifierCornerRadius).toBe(24);

    fireEvent.click(screen.getByRole("button", { name: "Magnifier zoom: 200%" }));
    const zoomList = screen.getByTestId("annotation-number-list-magnifier-zoom");
    expect(within(zoomList).getByRole("button", { name: "Magnifier zoom: 200%" })).not.toBeNull();
    expect(within(zoomList).getByRole("button", { name: "Magnifier zoom: 400%" })).not.toBeNull();
    expect(within(zoomList).getByRole("button", { name: "Magnifier zoom: 210%" })).not.toBeNull();
    expect(within(zoomList).queryByRole("button", { name: "Magnifier zoom: 190%" })).toBeNull();
    expect(within(zoomList).queryByRole("button", { name: "Magnifier zoom: 205%" })).toBeNull();
    fireEvent.click(within(zoomList).getByRole("button", { name: "Magnifier zoom: 350%" }));

    expect(useAnnotation.getState().activeStyle.magnifierZoom).toBe(3.5);
  });

  it("keeps spotlight out of shape fill options and exposes it as its own shape tool", () => {
    const { rerender } = render(<PropertyPanel tool="rect" />);

    expect(screen.getByRole("button", { name: "Hollow" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Filled" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Focus" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Focus opacity:/ })).toBeNull();

    rerender(<PropertyPanel tool="ellipse" />);

    expect(screen.getByRole("button", { name: "Hollow" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Filled" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Focus" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Focus opacity:/ })).toBeNull();

    rerender(<PropertyPanel tool="spotlight" />);

    const rectangleTab = screen.getByRole("tab", { name: "Rectangle" });
    const circleTab = screen.getByRole("tab", { name: "Circle" });
    expect(rectangleTab.querySelector(".lucide-square")).not.toBeNull();
    expect(circleTab.querySelector(".lucide-circle")).not.toBeNull();

    fireEvent.click(circleTab);
    expect(useAnnotation.getState().activeStyle.spotlightShape).toBe("circle");

    rerender(<PropertyPanel tool="line" />);

    expect(screen.queryByRole("button", { name: "Focus" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Focus opacity:/ })).toBeNull();
  });

  it("shows immediate custom tooltips for numeric controls on hover", () => {
    render(<PropertyPanel tool="rect" />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Stroke width:/ }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("Stroke width [px]");
    expect(tooltip.getAttribute("style")).toContain("background: rgba(18, 18, 18, 0.72)");
  });

  it("selects stroke, radius, and font size values from continuous scrollable lists", () => {
    const { rerender } = render(<PropertyPanel tool="rect" />);

    fireEvent.click(screen.getByRole("button", { name: "Stroke width: 4" }));
    const strokeList = screen.getByTestId("annotation-number-list-stroke-width");
    expect(strokeList.className).toContain("flashot-dark-scrollbar");
    expect(strokeList.style.maxHeight).toBe("200px");
    expect(within(strokeList).getByRole("button", { name: "Stroke width: 1" })).not.toBeNull();
    expect(within(strokeList).getByRole("button", { name: "Stroke width: 20" })).not.toBeNull();
    expect(within(strokeList).queryByRole("button", { name: "Stroke width: 21" })).toBeNull();
    expect(within(strokeList).queryByText("1px")).toBeNull();
    fireEvent.click(within(strokeList).getByRole("button", { name: "Stroke width: 19" }));

    fireEvent.click(screen.getByRole("button", { name: "Corner radius: 0" }));
    const radiusList = screen.getByTestId("annotation-number-list-corner-radius");
    expect(radiusList.className).toContain("flashot-dark-scrollbar");
    expect(within(radiusList).getByRole("button", { name: "Corner radius: 0" })).not.toBeNull();
    expect(within(radiusList).getByRole("button", { name: "Corner radius: 60" })).not.toBeNull();
    expect(within(radiusList).queryByRole("button", { name: "Corner radius: 61" })).toBeNull();
    fireEvent.click(within(radiusList).getByRole("button", { name: "Corner radius: 57" }));

    act(() => {
      useAnnotation.getState().setActiveStyle({ fontSize: 24 });
    });
    rerender(<PropertyPanel tool="text" />);
    fireEvent.click(screen.getByRole("button", { name: "Font size: 24" }));
    const fontSizeList = screen.getByTestId("annotation-number-list-font-size");
    expect(fontSizeList.className).toContain("flashot-dark-scrollbar");
    expect(within(fontSizeList).getByRole("button", { name: "Font size: 1" })).not.toBeNull();
    expect(within(fontSizeList).getByRole("button", { name: "Font size: 72" })).not.toBeNull();
    expect(within(fontSizeList).queryByRole("button", { name: "Font size: 73" })).toBeNull();
    fireEvent.click(within(fontSizeList).getByRole("button", { name: "Font size: 71" }));

    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(19);
    expect(useAnnotation.getState().activeStyle.cornerRadius).toBe(57);
    expect(useAnnotation.getState().activeStyle.fontSize).toBe(71);
  });

  it("scrolls numeric dropdowns to the current tool value when opened", () => {
    const scrolledLabels = captureScrollIntoViewLabels();
    useAnnotation.getState().setActiveStyle({ cornerRadius: 57 });

    try {
      render(<PropertyPanel tool="rect" />);

      fireEvent.click(screen.getByRole("button", { name: "Corner radius: 57" }));

      expect(scrolledLabels).toContain("Corner radius: 57");
    } finally {
      act(() => {
        useAnnotation.getState().setActiveStyle({ cornerRadius: 0 });
      });
    }
  });

  it("scrolls icon dropdowns to the current tool value when opened", () => {
    const scrolledLabels = captureScrollIntoViewLabels();
    useAnnotation.getState().setActiveStyle({ lineShape: "straight", lineStyle: "dashed" });

    try {
      render(<PropertyPanel tool="line" />);

      fireEvent.click(screen.getByLabelText("Line style: Dashed"));

      expect(scrolledLabels).toContain("Dashed");
    } finally {
      act(() => {
        useAnnotation.getState().setActiveStyle({ lineShape: "straight", lineStyle: "solid" });
      });
    }
  });

  it("scrolls the font dropdown to the current font when opened", async () => {
    const scrolledLabels = captureScrollIntoViewLabels();
    useAnnotation.getState().setActiveStyle({ fontFamily: "Times New Roman" });

    try {
      render(<PropertyPanel tool="text" />);
      await act(async () => {});

      fireEvent.click(screen.getByLabelText("Font: Times New Roman"));

      expect(scrolledLabels).toContain("Times New Roman");
    } finally {
      act(() => {
        useAnnotation.getState().setActiveStyle({ fontFamily: "system-ui" });
      });
    }
  });

  it("positions numeric tooltips from the property panel edge", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const el = this;
      if (el.hasAttribute("data-annotation-property-panel")) {
        return rect({ top: 100, left: 20, width: 360, height: 34 });
      }
      if (el.getAttribute("aria-label")?.startsWith("Stroke width:")) {
        return rect({ top: 107, left: 120, width: 74, height: 20 });
      }
      return rect();
    });

    render(<PropertyPanel tool="rect" />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Stroke width:/ }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.style.top).toBe("96px");
    expect(tooltip.style.bottom).toBe("");
  });

  it("adds hover tooltips to property panel operations", () => {
    render(<PropertyPanel tool="line" />);

    expect(screen.getByRole("button", { name: /^Stroke width:/ })).not.toBeNull();
    expect(screen.queryByLabelText("Decrease Stroke width")).toBeNull();
    expect(screen.queryByLabelText("Increase Stroke width")).toBeNull();
    const lineStyleButton = screen.getByLabelText("Line style: Solid");
    expect(lineStyleButton.getAttribute("title")).toBeNull();
    fireEvent.mouseEnter(lineStyleButton);

    expect(screen.getByRole("tooltip").textContent).toBe("Line style: Solid");
  });

  it("normalizes legacy handwriting font to system font in text panel", () => {
    useAnnotation.getState().setActiveStyle({ fontFamily: "handwriting" });

    render(<PropertyPanel tool="text" />);

    // Legacy "handwriting" normalizes to system-ui, displayed as platform name
    expect(screen.getByLabelText(/^Font:/)).not.toBeNull();
  });

  it("localizes the system font label in Traditional Chinese", () => {
    render(<PropertyPanel tool="text" locale="zh-TW" />);

    expect(screen.getByLabelText("字型：系統")).not.toBeNull();
  });

  it("uses centered SVG previews for line style dropdown options", () => {
    const { container, rerender } = render(<PropertyPanel tool="line" />);

    fireEvent.click(screen.getByLabelText("Line style: Solid"));

    expect(iconPaths(container, "solid")).toEqual(["M3 12h18"]);
    expect(iconCircles(container, "dotted")).toEqual([
      { cx: "6", cy: "12", r: "1.5" },
      { cx: "12", cy: "12", r: "1.5" },
      { cx: "18", cy: "12", r: "1.5" },
    ]);
    expect(iconPaths(container, "dashed")).toEqual([
      "M3 12h4",
      "M10 12h4",
      "M17 12h4",
    ]);

    rerender(<PropertyPanel tool="arrow" />);
    fireEvent.click(screen.getByLabelText("Line style: Solid"));

    expect(iconCircles(container, "dotted")).toEqual([
      { cx: "6", cy: "12", r: "1.5" },
      { cx: "12", cy: "12", r: "1.5" },
      { cx: "18", cy: "12", r: "1.5" },
    ]);
    expect(iconPaths(container, "dashed")).toEqual([
      "M3 12h4",
      "M10 12h4",
      "M17 12h4",
    ]);
  });

  it("renders dropdown menu choices as icon-only buttons with custom tooltips", () => {
    render(<PropertyPanel tool="line" />);

    fireEvent.click(screen.getByLabelText("Line style: Solid"));

    expect(screen.queryByText("Solid")).toBeNull();
    expect(screen.queryByText("Dotted")).toBeNull();

    const dottedOption = screen.getByLabelText("Dotted");
    expect(dottedOption.getAttribute("title")).toBeNull();
    fireEvent.mouseEnter(dottedOption);

    expect(screen.getByRole("tooltip").textContent).toBe("Dotted");
  });

  it("shows dropdown option tooltips to the right of each option", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const el = this;
      if (el.getAttribute("aria-label") === "Dotted") {
        return rect({ top: 120, left: 80, width: 28, height: 28 });
      }
      return rect();
    });
    render(<PropertyPanel tool="line" />);

    fireEvent.click(screen.getByLabelText("Line style: Solid"));
    fireEvent.mouseEnter(screen.getByLabelText("Dotted"));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("Dotted");
    expect(tooltip.style.left).toBe("112px");
    expect(tooltip.style.top).toBe("134px");
    expect(tooltip.style.transform).toBe("translateY(-50%)");
  });

  it("only offers open and filled arrowheads", () => {
    render(<PropertyPanel tool="arrow" />);

    fireEvent.click(screen.getByLabelText("Arrowhead: Open"));

    expect(screen.getByLabelText("Open")).not.toBeNull();
    expect(screen.getByLabelText("Filled")).not.toBeNull();
    expect(screen.queryByLabelText("Pointed")).toBeNull();
  });

  it("flips the custom color picker above the panel near the bottom edge", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 220 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 180,
      width: 18,
      height: 18,
      top: 180,
      right: 18,
      bottom: 198,
      left: 0,
      toJSON: () => {},
    } as DOMRect);

    render(<PropertyPanel tool="rect" />);
    const customColorButton = screen.getByLabelText("Custom color");

    fireEvent.click(customColorButton);

    const picker = customColorButton.nextElementSibling as HTMLElement | null;
    expect(picker).not.toBeNull();
    expect(picker!.style.bottom).toBe("calc(100% + 6px)");
    expect(picker!.style.top).toBe("");
  });

  it("closes the font dropdown when another property popover opens", () => {
    render(<PropertyPanel tool="text" />);

    fireEvent.click(screen.getByLabelText(/^Font:/));
    expect(screen.getByPlaceholderText("Search fonts...")).not.toBeNull();

    const customColorButton = screen.getByLabelText("Custom color");
    fireEvent.mouseDown(customColorButton);
    fireEvent.click(customColorButton);

    expect(screen.queryByPlaceholderText("Search fonts...")).toBeNull();
    expect(customColorButton.nextElementSibling).not.toBeNull();
  });

  it("uses a dark overlay scrollbar for the font list", () => {
    render(<PropertyPanel tool="text" />);

    fireEvent.click(screen.getByLabelText(/^Font:/));

    const fontList = screen.getByTestId("annotation-font-list");
    expect(fontList.className).toContain("flashot-dark-scrollbar");
    expect(fontList.style.background).toContain("rgba(30, 30, 30, 0.95)");
    expect(fontList.style.colorScheme).toBe("dark");
    expect(fontList.style.scrollbarColor).toContain("rgba(255, 255, 255, 0.32)");
  });

  it("keeps the property panel height fixed across icon and text controls", () => {
    const { container, rerender } = render(<PropertyPanel tool="rect" />);
    const iconPanel = container.querySelector("[data-annotation-property-panel]") as HTMLElement;

    expect(iconPanel.style.height).toBe("34px");
    expect(iconPanel.style.boxSizing).toBe("border-box");

    rerender(<PropertyPanel tool="text" />);
    const textPanel = container.querySelector("[data-annotation-property-panel]") as HTMLElement;

    expect(textPanel.style.height).toBe("34px");
    expect(textPanel.style.boxSizing).toBe("border-box");
  });

  it("keeps the hue slider thumb inside the hue track at the red edge", () => {
    render(<PropertyPanel tool="rect" />);

    fireEvent.click(screen.getByLabelText("Custom color"));

    const picker = screen.getByLabelText("Custom color").nextElementSibling as HTMLElement | null;
    const hueTrack = picker?.children[1] as HTMLElement | undefined;
    const hueThumb = hueTrack?.firstElementChild as HTMLElement | undefined;
    expect(hueThumb).toBeTruthy();
    expect(hueThumb!.style.left).toBe("5px");
    expect(hueThumb!.style.boxSizing).toBe("border-box");
  });
});

function iconPaths(container: HTMLElement, style: string): string[] {
  const icon = container.querySelector(`svg[data-line-style-icon="${style}"]`);
  expect(icon).not.toBeNull();
  return Array.from(icon!.querySelectorAll("path")).map((path) => path.getAttribute("d") ?? "");
}

function iconCircles(container: HTMLElement, style: string): Array<{ cx: string; cy: string; r: string }> {
  const icon = container.querySelector(`svg[data-line-style-icon="${style}"]`);
  expect(icon).not.toBeNull();
  return Array.from(icon!.querySelectorAll("circle")).map((circle) => ({
    cx: circle.getAttribute("cx") ?? "",
    cy: circle.getAttribute("cy") ?? "",
    r: circle.getAttribute("r") ?? "",
  }));
}

function fillOptionIcon(container: HTMLElement, title: string): SVGElement {
  const button = container.querySelector(`button[aria-label="${title}"]`);
  expect(button).not.toBeNull();
  const svg = button!.querySelector("svg");
  expect(svg).not.toBeNull();
  return svg!;
}

function rect(partial: Partial<DOMRect> = {}): DOMRect {
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
    toJSON: () => {},
  } as DOMRect;
}

function captureScrollIntoViewLabels(): string[] {
  const labels: string[] = [];
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement) {
      labels.push(this.getAttribute("aria-label") ?? this.textContent ?? "");
    },
  });
  return labels;
}

function restoreScrollIntoView() {
  if (originalScrollIntoViewDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoViewDescriptor);
    return;
  }

  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
}
