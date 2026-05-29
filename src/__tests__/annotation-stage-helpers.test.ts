import { beforeAll, describe, expect, it, vi } from "vitest";
import Konva from "konva";
import {
  ANNOTATION_ROTATE_ANCHOR_OFFSET,
  annotationAccentColor,
  cursorForAnnotationInteraction,
  isNodeInTree,
  shouldDeselectOnEmptyClick,
  snapNodeRotationToRightAngle,
  snapRotationToRightAngle,
  styleTransformerAnchor,
  transformerAccentConfig,
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
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
    } as unknown as CanvasRenderingContext2D);
  });

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

  it("allows hand-drawn objects to move without resize or rotation handles", () => {
    const config = transformerConfigForObject(object({ type: "draw", points: [0, 0, 20, 20] }));

    expect(config.useTransformer).toBe(true);
    expect(config.rotateEnabled).toBe(false);
    expect(config.enabledAnchors).toEqual([]);
  });

  it("keeps text and blur annotations resizable but not rotatable", () => {
    const textConfig = transformerConfigForObject(object({ type: "text", text: "Note" }));
    const blurConfig = transformerConfigForObject(object({ type: "blur" }));
    const magnifierConfig = transformerConfigForObject(object({ type: "magnifier" }));

    expect(textConfig.useTransformer).toBe(true);
    expect(textConfig.rotateEnabled).toBe(false);
    expect(textConfig.enabledAnchors.length).toBeGreaterThan(0);
    expect(blurConfig.useTransformer).toBe(true);
    expect(blurConfig.rotateEnabled).toBe(false);
    expect(blurConfig.enabledAnchors.length).toBeGreaterThan(0);
    expect(magnifierConfig.useTransformer).toBe(true);
    expect(magnifierConfig.rotateEnabled).toBe(false);
    expect(magnifierConfig.enabledAnchors.length).toBeGreaterThan(0);
  });

  it("allows markers to move without resize or rotation handles", () => {
    const config = transformerConfigForObject(object({
      type: "marker",
      markerNumber: 1,
    }));

    expect(config.useTransformer).toBe(true);
    expect(config.rotateEnabled).toBe(false);
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
      setAttrs: vi.fn(),
      sceneFunc: vi.fn(),
      hitFunc: vi.fn(),
    };
    const resizer = {
      hasName: () => false,
      width: () => 10,
      height: () => 10,
      cornerRadius: vi.fn(),
      setAttrs: vi.fn(),
      sceneFunc: vi.fn(),
      hitFunc: vi.fn(),
    };

    expect(styleTransformerAnchor(rotater as never)).toBe("grab");
    expect(rotater.setAttrs).toHaveBeenCalledWith(expect.objectContaining({
      fill: "rgba(0,0,0,0)",
      height: 20,
      stroke: "rgba(0,0,0,0)",
      strokeWidth: 0,
      width: 20,
    }));
    expect(rotater.cornerRadius).toHaveBeenCalledWith(0);
    expect(rotater.sceneFunc).toHaveBeenCalled();
    expect(rotater.hitFunc).toHaveBeenCalled();
    expect(styleTransformerAnchor(resizer as never)).toBeNull();
    expect(resizer.cornerRadius).not.toHaveBeenCalled();
    expect(resizer.setAttrs).not.toHaveBeenCalled();
  });

  it("uses the configured accent color for transformer chrome", () => {
    document.documentElement.style.setProperty("--flashot-accent", "#10B981");

    expect(annotationAccentColor()).toBe("#10B981");
    expect(transformerAccentConfig()).toEqual({
      borderStroke: "#10B981",
      anchorStroke: "#10B981",
    });
    expect(ANNOTATION_ROTATE_ANCHOR_OFFSET).toBeLessThan(30);
  });

  it("snaps rotations close to horizontal and vertical angles", () => {
    expect(snapRotationToRightAngle(3)).toBe(0);
    expect(snapRotationToRightAngle(87)).toBe(90);
    expect(snapRotationToRightAngle(184)).toBe(180);
    expect(snapRotationToRightAngle(269)).toBe(270);
    expect(snapRotationToRightAngle(44)).toBe(44);
  });

  it("snaps node rotation without moving the visual center", () => {
    const rect = new Konva.Rect({
      x: 30,
      y: 40,
      width: 100,
      height: 60,
      rotation: 3,
    });
    const before = rect.getClientRect();
    const beforeCenter = {
      x: before.x + before.width / 2,
      y: before.y + before.height / 2,
    };

    expect(snapNodeRotationToRightAngle(rect)).toBe(true);

    const after = rect.getClientRect();
    expect(rect.rotation()).toBe(0);
    expect(after.x + after.width / 2).toBeCloseTo(beforeCenter.x, 5);
    expect(after.y + after.height / 2).toBeCloseTo(beforeCenter.y, 5);
  });
});
