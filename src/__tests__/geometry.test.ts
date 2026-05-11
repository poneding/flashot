import { describe, it, expect } from "vitest";
import {
  computeToolbarPosition,
  TOOLBAR_GAP,
  hitTestHandle,
  moveRect,
  resizeRect,
  HandleId,
} from "@/lib/geometry";
import type { Point, Rect } from "@/lib/types";

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

describe("resizeRect", () => {
  const sel: Rect = { x: 100, y: 100, width: 200, height: 160 };

  it("expands from the south-east handle", () => {
    const resized = resizeRect(sel, "se", { x: 360, y: 310 }, monitor);

    expect(resized).toEqual({ x: 100, y: 100, width: 260, height: 210 });
  });

  it("moves the north-west corner and preserves the opposite corner", () => {
    const resized = resizeRect(sel, "nw", { x: 80, y: 70 }, monitor);

    expect(resized).toEqual({ x: 80, y: 70, width: 220, height: 190 });
  });

  it("clamps resize to the monitor and minimum size", () => {
    const resized = resizeRect(sel, "nw", { x: 500, y: 500 }, monitor, 24);

    expect(resized).toEqual({ x: 276, y: 236, width: 24, height: 24 });
  });
});

describe("moveRect", () => {
  it("translates by cursor delta", () => {
    const sel: Rect = { x: 100, y: 120, width: 200, height: 160 };
    const origin: Point = { x: 140, y: 150 };
    const moved = moveRect(sel, origin, { x: 190, y: 190 }, monitor);

    expect(moved).toEqual({ x: 150, y: 160, width: 200, height: 160 });
  });

  it("keeps the whole rect inside monitor bounds", () => {
    const sel: Rect = { x: 1800, y: 1000, width: 200, height: 160 };
    const moved = moveRect(sel, { x: 1810, y: 1010 }, { x: 1900, y: 1100 }, monitor);

    expect(moved).toEqual({ x: 1720, y: 920, width: 200, height: 160 });
  });
});
