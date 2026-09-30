import { describe, expect, it } from "vitest";
import { fitPinToolContents } from "@/pin/floating-layout";

describe("pin floating palette bounds", () => {
  it("grows left for an open popup and retains the controls' screen anchor", () => {
    const controls = { x: 6, y: 6, width: 40, height: 212 };
    const popup = { x: -220, y: 6, width: 220, height: 240 };
    const result = fitPinToolContents(controls, controls, [popup]);
    expect(result.offset).toEqual({ left: 226, top: 0 });
    expect(result.layout).toEqual({ width: 266, height: 240, anchorX: 226, anchorY: 0, anchorWidth: 40, anchorHeight: 212 });
    expect(fitPinToolContents(controls, controls, []).layout.width).toBe(40);
  });

  it("includes a wide toolbar and upward popovers independently of pin image size", () => {
    const toolbar = { x: 6, y: 6, width: 540, height: 40 };
    const popup = { x: 350, y: -210, width: 260, height: 200 };
    const result = fitPinToolContents(toolbar, toolbar, [popup]);
    expect(result.layout.width).toBe(604);
    expect(result.layout.height).toBe(256);
    expect(result.layout.anchorY).toBe(216);
    expect(result.layout.anchorWidth).toBe(540);
  });

  it("settles on the same bounds after the content offset changes", () => {
    const origin = { x: 6, y: 6, width: 40, height: 212 };
    const popup = { x: -100, y: -20, width: 100, height: 240 };
    const before = fitPinToolContents(origin, origin, [popup]);
    const move = (r: typeof origin) => ({ ...r, x: r.x + 106, y: r.y + 26 });
    const after = fitPinToolContents(move(origin), move(origin), [move(popup)]);
    expect(after).toEqual(before);
  });
});
