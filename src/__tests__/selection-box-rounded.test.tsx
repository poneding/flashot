import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { SelectionBox } from "@/overlay/SelectionBox";
import { useOverlay } from "@/overlay/state";

describe("SelectionBox rounded outline", () => {
  beforeEach(() => {
    useOverlay.setState({
      mode: "committed",
      selection: { x: 10, y: 10, width: 100, height: 80 },
      cornerRadius: 0,
      colorPickerVisible: false,
    });
  });

  it("renders a rounded SVG rect when cornerRadius > 0", () => {
    useOverlay.setState({ cornerRadius: 12 });
    const { container } = render(<SelectionBox />);
    const rect = container.querySelector("svg rect");
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute("rx")).toBe("12");
    expect(rect?.getAttribute("ry")).toBe("12");
    expect(rect?.getAttribute("x")).toBe("-0.75");
    expect(rect?.getAttribute("y")).toBe("-0.75");
    expect(rect?.getAttribute("width")).toBe("101.5");
    expect(rect?.getAttribute("height")).toBe("81.5");
    expect(rect?.getAttribute("fill")).toBe("none");
    expect(rect?.getAttribute("stroke-width")).toBe("1.5");
    expect(rect?.getAttribute("stroke")).toBe("var(--flashot-accent)");
  });

  it("renders an outside-only square outline during scrolling regardless of store cornerRadius", () => {
    useOverlay.setState({ cornerRadius: 20, mode: "scrolling" });
    const { container } = render(<SelectionBox />);
    const outline = Array.from(container.querySelectorAll("[data-scroll-selection-outline]")) as HTMLElement[];
    expect(container.querySelector("svg rect")).toBeNull();
    expect(outline).toHaveLength(4);
    expect(outline.map((el) => el.getAttribute("data-edge"))).toEqual(["top", "right", "bottom", "left"]);
    expect(outline[0].style.left).toBe("10px");
    expect(outline[0].style.top).toBe("8.5px");
    expect(outline[1].style.left).toBe("110px");
    expect(outline[1].style.top).toBe("10px");
    expect(outline[2].style.left).toBe("10px");
    expect(outline[2].style.top).toBe("90px");
    expect(outline[3].style.left).toBe("8.5px");
    expect(outline[3].style.top).toBe("10px");
  });
});
