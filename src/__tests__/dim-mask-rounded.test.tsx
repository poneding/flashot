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

  it("renders four dim tiles and four tiny corner masks for rounded selections", () => {
    useOverlay.setState({ cornerRadius: 16 });
    const { container } = render(<DimMask />);

    expect(container.querySelector("svg[data-dim-mask='partial']")).toBeNull();
    expect(container.querySelectorAll("[data-dim-mask-tile]")).toHaveLength(4);
    expect(container.querySelectorAll("svg[data-dim-mask-corner]")).toHaveLength(4);
  });

  it("uses tiny corner masks for a hovered window hole", () => {
    useOverlay.setState({
      mode: "hover",
      selection: null,
      hoverRect: { x: 100, y: 100, width: 200, height: 150 },
      hoverTarget: "window",
      cornerRadius: 16,
    });
    const { container } = render(<DimMask />);

    expect(container.querySelector("svg[data-dim-mask='partial']")).toBeNull();
    expect(container.querySelectorAll("[data-dim-mask-tile]")).toHaveLength(4);
    expect(container.querySelectorAll("svg[data-dim-mask-corner]")).toHaveLength(4);
  });

  it("keeps a full-monitor hover hole sharp", () => {
    useOverlay.setState({
      mode: "hover",
      selection: null,
      hoverRect: { x: 0, y: 0, width: 800, height: 600 },
      hoverTarget: "monitor",
      cornerRadius: 16,
    });
    const { container } = render(<DimMask />);

    expect(container.querySelector("svg[data-dim-mask='partial']")).toBeNull();
    expect(container.querySelectorAll("[data-dim-mask-tile]")).toHaveLength(4);
    expect(container.querySelectorAll("svg[data-dim-mask-corner]")).toHaveLength(0);
  });

  it("uses only div tiles for sharp selection holes", () => {
    const { container } = render(<DimMask />);

    expect(container.querySelector("svg[data-dim-mask='partial']")).toBeNull();
    expect(container.querySelectorAll("[data-dim-mask-tile]")).toHaveLength(4);
    expect(container.querySelectorAll("svg[data-dim-mask-corner]")).toHaveLength(0);
  });

  it("forces a sharp hole during scrolling capture", () => {
    useOverlay.setState({ cornerRadius: 16, mode: "scrolling" });
    const { container } = render(<DimMask />);
    expect(container.firstChild).toBeNull();
  });
});
