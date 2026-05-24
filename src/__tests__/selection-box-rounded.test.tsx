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
  });

  it("forces rx=0 during scrolling regardless of store cornerRadius", () => {
    useOverlay.setState({ cornerRadius: 20, mode: "scrolling" });
    const { container } = render(<SelectionBox />);
    const rect = container.querySelector("svg rect");
    expect(rect?.getAttribute("rx")).toBe("0");
  });
});
