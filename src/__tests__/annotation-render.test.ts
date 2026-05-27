/** @vitest-environment jsdom */
import { beforeAll, describe, expect, it, vi } from "vitest";
import Konva from "konva";
import { renderEllipseObject } from "@/annotation/tools/ellipse";
import {
  TEXT_LINE_HEIGHT,
  resolveSystemFont,
} from "@/annotation/fonts";
import { highlightMaskPixelRatio, renderHighlightObject } from "@/annotation/tools/highlight";
import { lineControlPoint, renderLineObject } from "@/annotation/tools/line";
import { renderMeasureObject } from "@/annotation/tools/measure";
import { renderRectObject } from "@/annotation/tools/rect";
import { renderObject } from "@/annotation/render";
import { renderTextObject } from "@/annotation/tools/text";
import type { AnnotationObject } from "@/annotation/types";

function object(overrides: Partial<AnnotationObject>): AnnotationObject {
  return {
    id: "object-1",
    type: "rect",
    start: { x: 10, y: 20 },
    end: { x: 110, y: 80 },
    style: { color: "#ff0000", strokeWidth: 4, fill: "hollow" },
    transform: { x: 15, y: 25, scaleX: 1.5, scaleY: 0.75, rotation: 12 },
    ...overrides,
  };
}

describe("annotation object rendering", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
      measureText: vi.fn(() => ({ width: 48 })),
    } as unknown as CanvasRenderingContext2D);
  });

  it("applies saved transform offsets when rendering rectangles", () => {
    const node = renderRectObject(object({ type: "rect" }));

    expect(node.x()).toBe(25);
    expect(node.y()).toBe(45);
    expect(node.scaleX()).toBe(1.5);
    expect(node.rotation()).toBe(12);
  });

  it("keeps hollow rectangles hit-testable with transparent fill", () => {
    const node = renderRectObject(object({ type: "rect" }));

    expect(node.fill()).toBe("rgba(0,0,0,0)");
  });

  it("keeps rectangle stroke width independent from resize scale", () => {
    const node = renderRectObject(object({ type: "rect" }));

    expect(node.strokeWidth()).toBe(4);
    expect(node.strokeScaleEnabled()).toBe(false);
  });

  it("applies saved transform offsets when rendering ellipses", () => {
    const node = renderEllipseObject(object({ type: "ellipse" }));

    expect(node.x()).toBe(75);
    expect(node.y()).toBe(75);
    expect(node.scaleY()).toBe(0.75);
    expect(node.rotation()).toBe(12);
  });

  it("keeps ellipse stroke width independent from resize scale", () => {
    const node = renderEllipseObject(object({ type: "ellipse" }));

    expect(node.strokeWidth()).toBe(4);
    expect(node.strokeScaleEnabled()).toBe(false);
  });

  it("renders focused rectangles as a mask group preserving the object id", () => {
    const node = renderRectObject(object({
      type: "rect",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        fill: "hollow",
        focusMode: "spotlight",
        focusOpacity: 0.6,
        focusColor: "#111111",
      },
    }), { width: 320, height: 180 });

    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as unknown as Konva.Group;

    expect(group.id()).toBe("object-1");
    expect(group.findOne(".focus-mask")).toBeInstanceOf(Konva.Shape);
    expect(group.findOne(".focus-boundary")).toBeInstanceOf(Konva.Rect);
  });

  it("renders focused ellipses as a mask group preserving the object id", () => {
    const node = renderEllipseObject(object({
      type: "ellipse",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        fill: "hollow",
        focusMode: "spotlight",
        focusOpacity: 0.5,
        focusColor: "#000000",
      },
    }), { width: 320, height: 180 });

    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as unknown as Konva.Group;

    expect(group.id()).toBe("object-1");
    expect(group.findOne(".focus-mask")).toBeInstanceOf(Konva.Shape);
    expect(group.findOne(".focus-boundary")).toBeInstanceOf(Konva.Ellipse);
  });

  it("renders empty markers as a numbered badge without a bubble", () => {
    const node = renderObject(object({
      id: "marker-1",
      type: "marker",
      start: { x: 30, y: 40 },
      markerNumber: 5,
      text: "",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        markerFill: "#0099ff",
        markerTextColor: "#ffffff",
        markerBubbleFill: "#111827",
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }));

    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as Konva.Group;

    expect(group.findOne(".marker-badge")).toBeInstanceOf(Konva.Circle);
    expect((group.findOne(".marker-number") as Konva.Text).text()).toBe("5");
    expect(group.findOne(".marker-bubble")).toBeUndefined();
  });

  it("renders marker text inside a bubble when present", () => {
    const node = renderObject(object({
      id: "marker-2",
      type: "marker",
      start: { x: 30, y: 40 },
      markerNumber: 2,
      text: "Review this",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        markerFill: "#ff6600",
        markerTextColor: "#101010",
        markerBubbleFill: "#ffeecc",
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }));

    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as Konva.Group;

    expect(group.findOne(".marker-bubble")).toBeInstanceOf(Konva.Rect);
    expect((group.findOne(".marker-bubble-text") as Konva.Text).text()).toBe("Review this");
  });

  it("renders circle magnifiers with a clipped composited image and border", () => {
    const sourceImage = new Image();
    const node = renderObject(object({
      id: "magnifier-1",
      type: "magnifier",
      start: { x: 40, y: 50 },
      end: { x: 140, y: 150 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        magnifierShape: "circle",
        magnifierZoom: 1.5,
        magnifierBorderColor: "#0099ff",
        magnifierBorderWidth: 3,
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }), {
      stageSize: { width: 320, height: 180 },
      magnifier: {
        sourceImage,
        stageSize: { width: 320, height: 180 },
        scaleFactor: 1,
        objects: [],
      },
    });

    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as Konva.Group;

    expect(group.findOne(".magnifier-clip")).toBeInstanceOf(Konva.Group);
    expect(group.findOne(".magnifier-image")).toBeInstanceOf(Konva.Image);
    expect(group.findOne(".magnifier-border")).toBeInstanceOf(Konva.Circle);
    expect((group.findOne(".magnifier-image") as Konva.Image).image()).toBe(sourceImage);
  });

  it("renders rounded-rectangle magnifiers with a clipped composited image and border", () => {
    const sourceImage = new Image();
    const node = renderObject(object({
      id: "magnifier-2",
      type: "magnifier",
      start: { x: 40, y: 50 },
      end: { x: 160, y: 130 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        magnifierShape: "rounded-rect",
        magnifierZoom: 1.25,
        magnifierBorderColor: "#33cc33",
        magnifierBorderWidth: 2,
        magnifierCornerRadius: 16,
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }), {
      stageSize: { width: 320, height: 180 },
      magnifier: {
        sourceImage,
        stageSize: { width: 320, height: 180 },
        scaleFactor: 1,
        objects: [],
      },
    });

    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as Konva.Group;
    const border = group.findOne(".magnifier-border") as Konva.Rect;

    expect(group.findOne(".magnifier-clip")).toBeInstanceOf(Konva.Group);
    expect(group.findOne(".magnifier-image")).toBeInstanceOf(Konva.Image);
    expect(border).toBeInstanceOf(Konva.Rect);
    expect(border.cornerRadius()).toBe(16);
  });

  it("renders lines as endpoint-editable curves without whole-object dragging", () => {
    const line = object({
      type: "line",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      points: [50, 50],
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });
    const node = renderLineObject(line);
    const mainLine = node.findOne(".main-line") as Konva.Line;

    expect(node.draggable()).toBe(false);
    expect(mainLine?.points().length).toBeGreaterThan(6);
    expect(mainLine?.points().some((value, index) => index % 2 === 1 && value > 0)).toBe(true);
  });

  it("renders measurement labels from logical endpoint distance", () => {
    const measure = object({
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 5, y: 6, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    const node = renderMeasureObject(measure);
    const label = node.findOne(".measure-label") as Konva.Text;
    const background = node.findOne(".measure-label-bg") as Konva.Rect;

    expect(node.draggable()).toBe(false);
    expect(node.x()).toBe(5);
    expect(node.y()).toBe(6);
    expect(label.text()).toBe("50 px");
    expect(label.fill()).toBe("#ffffff");
    expect(background.fill()).toBe("#111827");
    expect(background.stroke()).toBe("#ff0000");
    expect(background.strokeWidth()).toBe(1);
  });

  it("dispatches measurement objects through renderObject", () => {
    const measure = object({
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    const node = renderObject(measure) as Konva.Group;
    const label = node.findOne(".measure-label") as Konva.Text;

    expect(label.text()).toBe("50 px");
  });

  it("keeps wavy lines wavy after center control-point edits", () => {
    const line = object({
      type: "line",
      start: { x: 0, y: 0 },
      end: { x: 120, y: 0 },
      points: [60, 40],
      style: { color: "#ff0000", strokeWidth: 4, lineShape: "wavy" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });
    const node = renderLineObject(line);
    const mainLine = node.findOne(".main-line") as Konva.Line;
    const points = mainLine.points();
    const pairCount = points.length / 2;

    const maxDistanceFromPlainCurve = Array.from({ length: pairCount }, (_, index) => {
      const t = index / (pairCount - 1);
      const mt = 1 - t;
      const curveX = mt * mt * 0 + 2 * mt * t * 60 + t * t * 120;
      const curveY = mt * mt * 0 + 2 * mt * t * 40 + t * t * 0;
      const dx = points[index * 2] - curveX;
      const dy = points[index * 2 + 1] - curveY;
      return Math.sqrt(dx * dx + dy * dy);
    }).reduce((max, distance) => Math.max(max, distance), 0);

    expect(maxDistanceFromPlainCurve).toBeGreaterThan(1);
  });

  it("renders filled arrows with a compact pointed filled head", () => {
    const arrow = object({
      type: "arrow",
      start: { x: 0, y: 0 },
      end: { x: 120, y: 0 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        arrow: "end",
        arrowStyle: "filled-triangle",
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });
    const node = renderLineObject(arrow);
    const head = lastLineHead(node);

    expect(head).toBeInstanceOf(Konva.Line);
    expect(head.closed()).toBe(true);
    expect(head.fill()).toBe("#ff0000");
    expect(head.points()[0]).toBeGreaterThan(105);
    expect(head.points()[0]).toBeLessThan(109);
  });

  it("uses the line midpoint as the default center control point", () => {
    expect(lineControlPoint(object({
      type: "line",
      start: { x: 20, y: 40 },
      end: { x: 100, y: 80 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }))).toEqual({ x: 60, y: 60 });
  });

  it("resolves handwriting text to the English and Chinese handwriting font stack", () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load },
    });

    const node = renderTextObject(object({
      type: "text",
      start: { x: 0, y: 0 },
      text: "hello 你好",
      style: { color: "#ff0000", strokeWidth: 4, fontSize: 24, fontFamily: "handwriting" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }));

    // Legacy "handwriting" normalizes to system-ui
    expect(node.fontFamily()).toBe(resolveSystemFont());
    expect(node.lineHeight()).toBe(TEXT_LINE_HEIGHT);
  });

  it("renders highlights as a single-alpha mask so self-overlap does not darken", () => {
    const node = renderHighlightObject(object({
      type: "highlight",
      points: [0, 0, 40, 0, 20, 0, 60, 0],
      style: { color: "#ffcc00", strokeWidth: 4, opacity: 0.35 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }));
    const mask = node.findOne(".highlight-mask") as Konva.Shape;

    expect(node).toBeInstanceOf(Konva.Group);
    expect(mask).toBeInstanceOf(Konva.Shape);
    expect(mask).not.toBeInstanceOf(Konva.Line);
    expect(mask.opacity()).toBe(1);
    expect(mask.getAttr("highlightOpacity")).toBe(0.35);
    expect(mask.globalCompositeOperation()).toBe("source-over");
  });

  it("smooths freehand highlight points before drawing the mask", () => {
    const points = [0, 0, 8, 4, 16, -4, 24, 4, 32, 0];
    const node = renderHighlightObject(object({
      type: "highlight",
      points,
      style: { color: "#ffcc00", strokeWidth: 4, opacity: 0.35 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }));
    const mask = node.findOne(".highlight-mask") as Konva.Shape;
    const renderPoints = mask.getAttr("highlightPoints") as number[];

    expect(renderPoints.length).toBeGreaterThan(points.length);
  });

  it("uses at least a 2x mask pixel ratio for smoother highlight edges", () => {
    expect(highlightMaskPixelRatio(1)).toBe(2);
    expect(highlightMaskPixelRatio(2.5)).toBe(2.5);
  });

  it("passes highlight corner radius through to the mask renderer", () => {
    const node = renderHighlightObject(object({
      type: "highlight",
      points: [0, 0, 80, 0],
      style: { color: "#ffcc00", strokeWidth: 4, cornerRadius: 12, opacity: 0.35 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }));
    const mask = node.findOne(".highlight-mask") as Konva.Shape;

    expect(mask.getAttr("highlightCornerRadius")).toBe(12);
  });
});

function lastLineHead(node: Konva.Group): Konva.Line {
  const children = node.getChildren();
  const head = children[children.length - 1];
  expect(head).toBeInstanceOf(Konva.Line);
  return head as Konva.Line;
}
