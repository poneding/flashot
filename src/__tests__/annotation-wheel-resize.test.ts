import { describe, expect, it } from "vitest";
import {
  WHEEL_RESIZE_THRESHOLD,
  wheelResizeStep,
  annotationResizeUpdates,
} from "@/annotation/Stage";
import type { AnnotationObject } from "@/annotation/types";

function obj(overrides: Partial<AnnotationObject> = {}): AnnotationObject {
  return {
    id: "o1",
    type: "rect",
    start: { x: 0, y: 0 },
    end: { x: 100, y: 80 },
    style: { color: "#ff0000", strokeWidth: 4 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    ...overrides,
  };
}

describe("wheelResizeStep — trackpad pacing", () => {
  it("does not advance until the accumulator crosses the threshold", () => {
    // A trackpad fires many small-delta events; none alone should step.
    let accum = 0;
    const small = WHEEL_RESIZE_THRESHOLD / 10;
    for (let i = 0; i < 9; i++) {
      const r = wheelResizeStep(accum, small);
      expect(r.step).toBe(0);
      accum = r.nextAccum;
    }
    // The 10th crosses the threshold → exactly one step.
    const crossed = wheelResizeStep(accum, small);
    expect(crossed.step).toBe(-1); // wheel-down (positive delta) shrinks
    expect(crossed.nextAccum).toBe(0); // resets after stepping
  });

  it("takes exactly one step per threshold, not one per event", () => {
    // Regression: previously every |delta|>5 event advanced a step, so a
    // single trackpad gesture raced through dozens of steps.
    let accum = 0;
    let steps = 0;
    for (let i = 0; i < 30; i++) {
      const r = wheelResizeStep(accum, 10); // 30 events * 10 = 300 total
      accum = r.nextAccum;
      if (r.step !== 0) steps++;
    }
    // 300 / 80 threshold ≈ 3 steps, NOT 30.
    expect(steps).toBe(3);
  });

  it("wheel-up grows, wheel-down shrinks", () => {
    expect(wheelResizeStep(0, -WHEEL_RESIZE_THRESHOLD).step).toBe(1); // up = grow
    expect(wheelResizeStep(0, WHEEL_RESIZE_THRESHOLD).step).toBe(-1); // down = shrink
  });

  it("resets the accumulator on a direction flip for instant response", () => {
    // Build up positive accumulation, then flip negative.
    const built = wheelResizeStep(0, WHEEL_RESIZE_THRESHOLD - 1);
    expect(built.step).toBe(0);
    expect(built.nextAccum).toBe(WHEEL_RESIZE_THRESHOLD - 1);
    const flipped = wheelResizeStep(built.nextAccum, -10);
    expect(flipped.nextAccum).toBe(-10); // discarded the stale positive accum
  });
});

describe("annotationResizeUpdates — which types resize and how", () => {
  it("adjusts strokeWidth for rect and ellipse (the reported gap)", () => {
    // Regression: rect/ellipse had no wheel branch at all.
    expect(annotationResizeUpdates(obj({ type: "rect" }), 1)).toEqual({
      kind: "style",
      updates: { strokeWidth: 5 },
    });
    expect(annotationResizeUpdates(obj({ type: "ellipse" }), -1)).toEqual({
      kind: "style",
      updates: { strokeWidth: 3 },
    });
  });

  it("adjusts strokeWidth for line, arrow, highlight, draw, measure", () => {
    for (const type of ["line", "arrow", "highlight", "draw", "measure"] as const) {
      expect(annotationResizeUpdates(obj({ type }), 1)).toEqual({
        kind: "style",
        updates: { strokeWidth: 5 },
      });
    }
  });

  it("adjusts blurIntensity for blur", () => {
    expect(
      annotationResizeUpdates(obj({ type: "blur", style: { color: "#000", strokeWidth: 4, blurIntensity: 10 } }), 1),
    ).toEqual({ kind: "style", updates: { blurIntensity: 11 } });
  });

  it("adjusts fontSize for text (step ×4) and marker (step ×2)", () => {
    expect(
      annotationResizeUpdates(obj({ type: "text", style: { color: "#000", strokeWidth: 4, fontSize: 20 } }), 1),
    ).toEqual({ kind: "style", updates: { fontSize: 24 } });
    expect(
      annotationResizeUpdates(obj({ type: "marker", style: { color: "#000", strokeWidth: 4, fontSize: 20 } }), 1),
    ).toEqual({ kind: "style", updates: { fontSize: 22 } });
  });

  it("rescales magnifier/spotlight bounds around the center", () => {
    const r = annotationResizeUpdates(
      obj({ type: "spotlight", start: { x: 100, y: 100 }, end: { x: 200, y: 200 } }),
      1,
    );
    expect(r?.kind).toBe("bounds");
    // Center (150,150) preserved; size 100 → 110, so ±55 each way.
    expect(r?.kind === "bounds" && r.updates.start).toEqual({ x: 95, y: 95 });
    expect(r?.kind === "bounds" && r.updates.end).toEqual({ x: 205, y: 205 });
  });

  it("clamps and returns null when no change would occur", () => {
    // strokeWidth already at max 30, stepping up does nothing.
    expect(annotationResizeUpdates(obj({ style: { color: "#000", strokeWidth: 30 } }), 1)).toBeNull();
  });
});
