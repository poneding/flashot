import { describe, it, expect } from "vitest";
import { hitTestWindow } from "@/lib/hit-test";
import type { WindowRect } from "@/lib/types";

const w = (x: number, y: number, width: number, height: number, title = "x"): WindowRect => ({
  rect: { x, y, width, height },
  title,
  appName: title,
  pid: 1,
});

describe("hitTestWindow", () => {
  it("returns null when list is empty", () => {
    expect(hitTestWindow({ x: 10, y: 10 }, [])).toBeNull();
  });

  it("returns null when point is outside every window", () => {
    expect(hitTestWindow({ x: 1000, y: 1000 }, [w(0, 0, 100, 100)])).toBeNull();
  });

  it("returns the only matching window", () => {
    const a = w(0, 0, 100, 100, "A");
    expect(hitTestWindow({ x: 50, y: 50 }, [a])).toEqual(a);
  });

  it("returns the topmost (first in z-order) when overlapping", () => {
    const front = w(0, 0, 100, 100, "front");
    const back = w(0, 0, 200, 200, "back");
    // front is first → topmost
    expect(hitTestWindow({ x: 50, y: 50 }, [front, back])).toEqual(front);
  });

  it("returns the smaller window when the front window does NOT contain the point", () => {
    const front = w(0, 0, 50, 50, "front");
    const back = w(0, 0, 200, 200, "back");
    expect(hitTestWindow({ x: 100, y: 100 }, [front, back])).toEqual(back);
  });

  it("treats borders as inside (inclusive top-left, exclusive bottom-right)", () => {
    const a = w(10, 10, 100, 100, "A");
    expect(hitTestWindow({ x: 10, y: 10 }, [a])).toEqual(a);     // TL inclusive
    expect(hitTestWindow({ x: 110, y: 110 }, [a])).toBeNull();   // BR exclusive
  });
});
