import { describe, expect, it, vi } from "vitest";
import {
  cursorForAnnotationInteraction,
  isNodeInTree,
  shouldDeselectOnEmptyClick,
  styleTransformerAnchor,
  transformerConfigForObject,
  shouldReplaceRenderedObject,
} from "@/annotation/Stage";
import type { AnnotationObject } from "@/annotation/types";

function fakeNode(parent: unknown = null): { getParent: () => unknown } {
  return { getParent: () => parent };
}

function object(overrides: Partial<AnnotationObject> = {}): AnnotationObject {
  return {
    id: "rect-1",
    type: "rect",
    start: { x: 10, y: 10 },
    end: { x: 80, y: 60 },
    style: { color: "#ff0000", strokeWidth: 4 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    ...overrides,
  };
}

describe("annotation stage helpers", () => {
  it("recognizes transformer descendants as transformer interactions", () => {
    const transformer = fakeNode();
    const anchor = fakeNode(transformer);
    const anchorChild = fakeNode(anchor);

    expect(isNodeInTree(anchorChild as never, transformer as never)).toBe(true);
    expect(isNodeInTree(fakeNode() as never, transformer as never)).toBe(false);
  });

  it("does not replace rendered nodes for transform-only updates", () => {
    const before = object();
    const moved = {
      ...before,
      transform: { x: 30, y: 12, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    const restyled = object({ style: { color: "#0099ff", strokeWidth: 4 } });

    expect(shouldReplaceRenderedObject(before, moved)).toBe(false);
    expect(shouldReplaceRenderedObject(before, restyled)).toBe(true);
  });

  it("excludes lines, arrows, and measurements from transformer resize/rotate editing", () => {
    expect(transformerConfigForObject(object({ type: "line" })).useTransformer).toBe(false);
    expect(transformerConfigForObject(object({ type: "arrow" })).useTransformer).toBe(false);
    expect(transformerConfigForObject(object({ type: "measure" })).useTransformer).toBe(false);
  });

  it("replaces rendered measurements when endpoints change", () => {
    const before = object({
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
    });
    const after = {
      ...before,
      end: { x: 60, y: 80 },
    };

    expect(shouldReplaceRenderedObject(before, after)).toBe(true);
  });

  it("allows hand-drawn objects to drag and rotate without resize anchors", () => {
    const config = transformerConfigForObject(object({ type: "draw", points: [0, 0, 20, 20] }));

    expect(config.useTransformer).toBe(true);
    expect(config.rotateEnabled).toBe(true);
    expect(config.enabledAnchors).toEqual([]);
  });

  it("uses interaction cursors instead of the active drawing crosshair", () => {
    expect(cursorForAnnotationInteraction("drag")).toBe("move");
    expect(cursorForAnnotationInteraction("rotate")).toBe("grab");
    expect(cursorForAnnotationInteraction("point")).toBe("grab");
  });

  it("clears a selected object when clicking empty annotation space", () => {
    expect(shouldDeselectOnEmptyClick("rect-1", "rect")).toBe(true);
    expect(shouldDeselectOnEmptyClick(null, "rect")).toBe(false);
    expect(shouldDeselectOnEmptyClick("rect-1", "text")).toBe(false);
  });

  it("styles only the rotate anchor as round and non-crosshair", () => {
    const rotater = {
      hasName: (name: string) => name === "rotater",
      width: () => 10,
      height: () => 10,
      cornerRadius: vi.fn(),
    };
    const resizer = {
      hasName: () => false,
      width: () => 10,
      height: () => 10,
      cornerRadius: vi.fn(),
    };

    expect(styleTransformerAnchor(rotater as never)).toBe("grab");
    expect(rotater.cornerRadius).toHaveBeenCalledWith(5);
    expect(styleTransformerAnchor(resizer as never)).toBeNull();
    expect(resizer.cornerRadius).not.toHaveBeenCalled();
  });
});
