import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { DimMask } from "@/overlay/DimMask";
import { useOverlay } from "@/overlay/state";

describe("DimMask rounded hole", () => {
  beforeEach(() => {
    useOverlay.setState({
      mode: "committed",
      monitorRect: { x: 0, y: 0, width: 800, height: 600 },
      selection: { x: 100, y: 100, width: 200, height: 150 },
      hoverRect: null,
      cornerRadius: 0,
    });
  });

  it("renders a hole rect with the live cornerRadius as rx", () => {
    useOverlay.setState({ cornerRadius: 16 });
    const { container } = render(<DimMask />);
    const holeRect = container.querySelector("svg mask rect[fill='black']");
    expect(holeRect).not.toBeNull();
    expect(holeRect?.getAttribute("rx")).toBe("16");
  });

  it("forces a sharp hole during scrolling capture", () => {
    useOverlay.setState({ cornerRadius: 16, mode: "scrolling" });
    const { container } = render(<DimMask />);
    expect(container.firstChild).toBeNull();
  });
});
