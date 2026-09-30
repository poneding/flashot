/** @vitest-environment jsdom */
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FloatingWindowContext } from "@/annotation/FloatingWindowContext";
import { TooltipBubble } from "@/annotation/Tooltip";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Palette({ direction, placement }: { direction: "bottom" | "top" | "right"; placement?: "left" }) {
  const anchor = useRef<HTMLButtonElement>(null);
  return <FloatingWindowContext.Provider value={direction}>
    <div data-annotation-toolbar><button ref={anchor}>Tool</button>
      <TooltipBubble label="Tool help" anchorRef={anchor} placement={placement} />
    </div>
  </FloatingWindowContext.Provider>;
}

it("keeps a palette tooltip outside the image as its small native viewport grows", () => {
  vi.stubGlobal("innerHeight", 40);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const width = this.hasAttribute("data-annotation-toolbar") ? 540 : 32;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 40, width, height: 40, toJSON() {} } as DOMRect;
  });
  const view = render(<Palette direction="bottom" />);
  const tooltip = screen.getByRole("tooltip");
  expect(tooltip.style.top).toBe("44px");
  vi.stubGlobal("innerHeight", 80);
  fireEvent(window, new Event("resize"));
  expect(tooltip.style.top).toBe("44px");
  // Moving the palette above the image reverses its outward direction once.
  view.rerender(<Palette direction="top" />);
  expect(tooltip.style.top).toBe("-4px");
});

it("opens sidebar help outward even when the shared control normally puts it on the left", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 40, bottom: 212, width: 40, height: 212, toJSON() {},
  } as DOMRect);
  render(<Palette direction="right" placement="left" />);
  expect(screen.getByRole("tooltip").style.left).toBe("44px");
  expect(screen.getByRole("tooltip").style.transform).toBe("translateY(-50%)");
});
