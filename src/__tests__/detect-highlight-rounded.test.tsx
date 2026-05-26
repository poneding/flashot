import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { DetectHighlight } from "@/overlay/DetectHighlight";
import { useOverlay } from "@/overlay/state";

describe("DetectHighlight rounded hover outline", () => {
  beforeEach(() => {
    useOverlay.setState({
      mode: "hover",
      hoverRect: { x: 100, y: 100, width: 200, height: 150 },
      hoverTarget: "window",
      cornerRadius: 16,
    });
  });

  it("uses the live cornerRadius when hover matches a window", () => {
    const { container } = render(<DetectHighlight />);
    const highlight = container.firstElementChild as HTMLElement | null;

    expect(highlight?.style.borderRadius).toBe("16px");
  });

  it("keeps the full-monitor fallback hover sharp", () => {
    useOverlay.setState({
      hoverRect: { x: 0, y: 0, width: 800, height: 600 },
      hoverTarget: "monitor",
      cornerRadius: 16,
    });

    const { container } = render(<DetectHighlight />);
    const highlight = container.firstElementChild as HTMLElement | null;

    expect(highlight?.style.borderRadius).toBe("0px");
  });
  it("uses the accent variable for the hover border and glow", () => {
    const { container } = render(<DetectHighlight />);
    const highlight = container.firstElementChild as HTMLElement | null;

    expect(highlight?.style.border).toBe("1.5px solid var(--flashot-accent)");
    expect(highlight?.style.boxShadow).toBe("0 0 14px rgba(var(--flashot-accent-rgb), 0.4)");
    expect(highlight?.style.background).toBe("var(--flashot-accent-soft)");
  });

});
