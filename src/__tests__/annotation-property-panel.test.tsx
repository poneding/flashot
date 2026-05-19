/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyPanel } from "@/annotation/PropertyPanel";
import { useAnnotation } from "@/annotation/store";

vi.mock("@/lib/ipc", () => ({
  listSystemFonts: vi.fn().mockResolvedValue(["Arial", "Helvetica", "Times New Roman"]),
}));

const defaultInnerHeight = window.innerHeight;

describe("Annotation property panel", () => {
  beforeEach(() => {
    localStorage.clear();
    useAnnotation.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it("uses a numeric corner radius control for rectangles", () => {
    render(<PropertyPanel tool="rect" />);

    expect(screen.queryByTitle("Sharp corners")).toBeNull();
    expect(screen.queryByTitle("Rounded corners")).toBeNull();
    expect(screen.getByTitle("Corner radius")).not.toBeNull();
    expect(screen.getByText("0px")).not.toBeNull();
  });

  it("keeps numeric control names in tooltips instead of visible labels", () => {
    render(<PropertyPanel tool="rect" />);

    expect(screen.queryByText("粗细")).toBeNull();
    expect(screen.queryByText("圆角")).toBeNull();
    expect(screen.queryByText("Stroke")).toBeNull();
    expect(screen.queryByText("Radius")).toBeNull();
    expect(screen.getByTitle("Stroke width")).not.toBeNull();
    expect(screen.getByTitle("Corner radius")).not.toBeNull();
  });

  it("shows immediate custom tooltips for numeric controls on hover", () => {
    render(<PropertyPanel tool="rect" />);

    fireEvent.mouseEnter(screen.getByTitle("Stroke width"));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("Stroke width");
    expect(tooltip.getAttribute("style")).toContain("background: rgba(18, 18, 18, 0.72)");
  });

  it("positions numeric tooltips from the property panel edge", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const el = this;
      if (el.hasAttribute("data-annotation-property-panel")) {
        return rect({ top: 100, left: 20, width: 360, height: 34 });
      }
      if (el.getAttribute("title") === "Stroke width") {
        return rect({ top: 107, left: 120, width: 74, height: 20 });
      }
      return rect();
    });

    render(<PropertyPanel tool="rect" />);

    fireEvent.mouseEnter(screen.getByTitle("Stroke width"));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.style.top).toBe("96px");
    expect(tooltip.style.bottom).toBe("");
  });

  it("adds hover tooltips to property panel operations", () => {
    render(<PropertyPanel tool="line" />);

    expect(screen.getByTitle("Decrease Stroke width")).not.toBeNull();
    expect(screen.getByTitle("Increase Stroke width")).not.toBeNull();
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
    const customColorButton = screen.getByTitle("Custom color");

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

    const customColorButton = screen.getByTitle("Custom color");
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

    fireEvent.click(screen.getByTitle("Custom color"));

    const picker = screen.getByTitle("Custom color").nextElementSibling as HTMLElement | null;
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
