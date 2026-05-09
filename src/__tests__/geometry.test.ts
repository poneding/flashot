import { describe, it, expect } from "vitest";
import {
  computeToolbarPosition,
  TOOLBAR_GAP,
  hitTestHandle,
  HandleId,
} from "@/lib/geometry";
import type { Rect } from "@/lib/types";

const monitor: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const TB = { width: 240, height: 40 };

describe("computeToolbarPosition", () => {
  it("places below when there is room", () => {
    const sel: Rect = { x: 100, y: 100, width: 400, height: 200 };
    const p = computeToolbarPosition(sel, TB, monitor);
    expect(p.kind).toBe("below");
    expect(p.x).toBe(sel.x);
    expect(p.y).toBe(sel.y + sel.height + TOOLBAR_GAP);
  });

  it("flips above when selection is at the bottom edge", () => {
    const sel: Rect = { x: 100, y: 1040, width: 400, height: 35 };
    const p = computeToolbarPosition(sel, TB, monitor);
    expect(p.kind).toBe("above");
    expect(p.y).toBe(sel.y - TB.height - TOOLBAR_GAP);
  });

  it("nudges left when toolbar would overflow right edge", () => {
    const sel: Rect = { x: 1800, y: 100, width: 100, height: 100 };
    const p = computeToolbarPosition(sel, TB, monitor);
    expect(p.kind).toBe("below");
    expect(p.x).toBe(monitor.width - TB.width - TOOLBAR_GAP);
  });

  it("falls back to inside when selection is full-screen", () => {
    const sel: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const p = computeToolbarPosition(sel, TB, monitor);
    expect(p.kind).toBe("inside");
  });
});

describe("hitTestHandle", () => {
  const sel: Rect = { x: 100, y: 100, width: 200, height: 200 };

  const cases: Array<[number, number, HandleId | null]> = [
    [100, 100, "nw"],
    [200, 100, "n"],
    [300, 100, "ne"],
    [300, 200, "e"],
    [300, 300, "se"],
    [200, 300, "s"],
    [100, 300, "sw"],
    [100, 200, "w"],
    [200, 200, null], // body
  ];

  it.each(cases)("hit %d,%d → %s", (x, y, expected) => {
    expect(hitTestHandle({ x, y }, sel, 8)).toBe(expected);
  });
});
