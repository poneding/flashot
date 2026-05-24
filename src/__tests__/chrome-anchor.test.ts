import { describe, it, expect } from "vitest";
import { computeChromeAnchor } from "@/lib/chrome-anchor";

const monitor = { x: 0, y: 0, width: 1920, height: 1080 };

describe("computeChromeAnchor", () => {
  it("places chrome below selection when room exists", () => {
    const r = computeChromeAnchor(
      { x: 100, y: 100, width: 400, height: 200 },
      monitor,
      { width: 400, height: 280 },
    );
    expect(r.side).toBe("below");
    expect(r.y).toBeGreaterThanOrEqual(300); // selection bottom + gap
  });

  it("places chrome above when no room below", () => {
    const r = computeChromeAnchor(
      { x: 100, y: 800, width: 400, height: 200 },
      monitor,
      { width: 400, height: 280 },
    );
    expect(r.side).toBe("above");
    expect(r.y + 280).toBeLessThanOrEqual(800);
  });

  it("falls back to overlap when neither side fits", () => {
    const tinyMonitor = { x: 0, y: 0, width: 500, height: 300 };
    const r = computeChromeAnchor(
      { x: 0, y: 0, width: 500, height: 300 },
      tinyMonitor,
      { width: 400, height: 280 },
    );
    expect(r.side).toBe("overlap");
  });

  it("clamps width within monitor bounds", () => {
    const r = computeChromeAnchor(
      { x: 50, y: 100, width: 50, height: 50 },
      monitor,
      { width: 400, height: 280 },
    );
    expect(r.width).toBe(400);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(monitor.width);
  });
});
