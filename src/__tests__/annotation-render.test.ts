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
import { blurSampleRectForObject } from "@/annotation/tools/blur";
import { renderObject } from "@/annotation/render";
import { renderTextObject } from "@/annotation/tools/text";
import { DEFAULT_STYLE, type AnnotationObject } from "@/annotation/types";
import {
  MARKER_BUBBLE_GAP,
  MARKER_BUBBLE_LINE_HEIGHT,
  MARKER_BUBBLE_PADDING_Y,
  defaultMarkerLabelAnchor,
  markerBadgeRadius,
} from "@/annotation/markerStyle";
import { markerConnectorPoints, markerPartDragUpdates } from "@/annotation/tools/marker";

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

  it("renders spotlight rectangles as borderless transparent hit targets", () => {
    const node = renderRectObject(object({
      type: "rect",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        fill: "spotlight",
      },
    }));

    expect(node).toBeInstanceOf(Konva.Rect);
    expect(node.id()).toBe("object-1");
    expect(node.fill()).toBe("rgba(0,0,0,0)");
    expect(node.strokeWidth()).toBe(0);
  });

  it("renders spotlight ellipses as borderless transparent hit targets", () => {
    const node = renderEllipseObject(object({
      type: "ellipse",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        fill: "spotlight",
      },
    }));

    expect(node).toBeInstanceOf(Konva.Ellipse);
    expect(node.id()).toBe("object-1");
    expect(node.fill()).toBe("rgba(0,0,0,0)");
    expect(node.strokeWidth()).toBe(0);
  });

  it("renders standalone circle spotlight annotations as borderless transparent hit targets", () => {
    const node = renderObject(object({
      type: "spotlight",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        fill: "spotlight",
        spotlightShape: "circle",
      },
    }));

    expect(node).toBeInstanceOf(Konva.Ellipse);
    expect((node as Konva.Ellipse).fill()).toBe("rgba(0,0,0,0)");
    expect((node as Konva.Ellipse).strokeWidth()).toBe(0);
  });

  it("renders empty markers as a numbered badge without a label", () => {
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
    expect(group.findOne(".marker-label-part")).toBeUndefined();
    expect(group.findOne(".marker-connector")).toBeUndefined();
  });

  it("renders marker badge and label as separately draggable parts with a connector", () => {
    const obj: AnnotationObject = {
      id: "marker-2", type: "marker", start: { x: 40, y: 40 }, end: { x: 140, y: 20 },
      markerNumber: 3, text: "step three",
      style: { ...DEFAULT_STYLE, markerFill: "#0099ff" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    const group = renderObject(obj) as Konva.Group;
    const badge = group.findOne(".marker-badge-part") as Konva.Group;
    const label = group.findOne(".marker-label-part") as Konva.Group;
    const connector = group.findOne(".marker-connector") as Konva.Line;
    expect(group.draggable()).toBe(false);
    expect(badge.draggable()).toBe(true);
    expect(label.draggable()).toBe(true);
    expect(connector).toBeTruthy();
    expect(connector.visible()).toBe(true);
    expect(connector.stroke()).toBe("#0099ff");
    expect(connector.dash()).toEqual([4, 3]);
    expect(connector.listening()).toBe(false);
    const labelRect = label.findOne(".marker-label-box") as Konva.Rect;
    expect(labelRect.stroke()).toBe("#0099ff");
    expect(labelRect.shadowColor()).toBe("#0099ff");
    expect(labelRect.fill()).toBe("#111827");
    expect((label.findOne(".marker-label-text") as Konva.Text).text()).toBe("step three");
    expect(group.findOne(".marker-bubble-pointer")).toBeUndefined();
  });

  it("derives a legacy label anchor when end is missing", () => {
    const obj: AnnotationObject = { id: "marker-3", type: "marker", start: { x: 40, y: 40 }, markerNumber: 1, text: "legacy", style: { ...DEFAULT_STYLE }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } };
    const group = renderObject(obj) as Konva.Group;
    const label = group.findOne(".marker-label-part") as Konva.Group;
    expect(label.x()).toBeGreaterThan(40); // sits right of the badge like the old bubble
    expect(label.x()).toBe(40 + markerBadgeRadius(DEFAULT_STYLE.fontSize) + MARKER_BUBBLE_GAP);
  });

  it("hides the connector when the label box overlaps the badge", () => {
    const obj: AnnotationObject = {
      id: "marker-overlap", type: "marker", start: { x: 40, y: 40 }, end: { x: 40, y: 40 },
      markerNumber: 2, text: "near",
      style: { ...DEFAULT_STYLE, markerFill: "#0099ff" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    const group = renderObject(obj) as Konva.Group;
    const connector = group.findOne(".marker-connector") as Konva.Line;
    expect(connector.visible()).toBe(false);
  });

  it("returns null connector points when the label overlaps the badge", () => {
    expect(markerConnectorPoints({ x: 0, y: 0 }, 10, { x: -5, y: -5, width: 10, height: 10 })).toBeNull();
    expect(markerConnectorPoints({ x: 0, y: 0 }, 10, { x: 12, y: -5, width: 10, height: 10 })).toBeNull();
  });

  it("places connector endpoints on the badge edge and the label box edge", () => {
    expect(markerConnectorPoints({ x: 0, y: 0 }, 10, { x: 30, y: -10, width: 20, height: 20 })).toEqual([10, 0, 30, 0]);
    expect(markerConnectorPoints({ x: 0, y: 0 }, 10, { x: -10, y: 30, width: 20, height: 20 })).toEqual([0, 10, 0, 30]);
    // Diagonal: badge exit point lies on the circle along the connector direction.
    expect(markerConnectorPoints({ x: 0, y: 0 }, 5, { x: 30, y: 40, width: 20, height: 20 })).toEqual([3, 4, 30, 40]);
  });

  it("persists marker part drags by baking the transform into both anchors", () => {
    const obj: AnnotationObject = {
      id: "marker-drag-updates", type: "marker", start: { x: 40, y: 40 }, end: { x: 140, y: 20 },
      markerNumber: 1, text: "note",
      style: { ...DEFAULT_STYLE, markerFill: "#0099ff" },
      transform: { x: 10, y: 6, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    const group = renderObject(obj) as Konva.Group;
    const labelPart = group.findOne(".marker-label-part") as Konva.Group;
    labelPart.position({ x: 180, y: 70 });

    const updates = markerPartDragUpdates(obj, group);

    expect(updates.start).toEqual({ x: 50, y: 46 });
    expect(updates.end).toEqual({ x: 190, y: 76 });
    expect(updates.transform).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  });

  it("translates a baked end anchor when dragging a badge-only marker", () => {
    const obj: AnnotationObject = {
      id: "marker-badge-only-drag", type: "marker", start: { x: 40, y: 40 }, end: { x: 61, y: 26.6 },
      markerNumber: 1, text: "",
      style: { ...DEFAULT_STYLE, markerFill: "#0099ff" },
      transform: { x: 10, y: 6, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    const group = renderObject(obj) as Konva.Group;
    expect(group.findOne(".marker-label-part")).toBeUndefined();
    const badgePart = group.findOne(".marker-badge-part") as Konva.Group;
    badgePart.position({ x: 90, y: 110 });

    const updates = markerPartDragUpdates(obj, group);

    expect(updates.start).toEqual({ x: 100, y: 116 });
    expect(updates.end).toEqual({ x: 61 + 10, y: 26.6 + 6 });
    expect(updates.transform).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
  });

  it("matches the legacy bubble offset for derived label anchors", () => {
    const anchor = defaultMarkerLabelAnchor({ x: 30, y: 40 }, "note", 14);
    const labelHeight = 14 * MARKER_BUBBLE_LINE_HEIGHT + MARKER_BUBBLE_PADDING_Y * 2;

    expect(anchor.x).toBe(30 + markerBadgeRadius(14) + MARKER_BUBBLE_GAP);
    expect(anchor.y).toBeCloseTo(40 - labelHeight / 2);
  });

  it("uses marker font size for the marker label text", () => {
    const node = renderObject(object({
      id: "marker-4",
      type: "marker",
      start: { x: 30, y: 40 },
      markerNumber: 3,
      text: "Larger note",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        markerFill: "#ff6600",
        fontSize: 20,
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    })) as Konva.Group;

    const text = node.findOne(".marker-label-text") as Konva.Text;

    expect(text.fontSize()).toBe(20);
  });

  it("uses marker font size for the numbered marker badge", () => {
    const node = renderObject(object({
      id: "marker-5",
      type: "marker",
      start: { x: 30, y: 40 },
      markerNumber: 4,
      text: "",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        markerFill: "#ff6600",
        fontSize: 20,
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    })) as Konva.Group;

    const badge = node.findOne(".marker-badge") as Konva.Circle;
    const number = node.findOne(".marker-number") as Konva.Text;

    expect(number.fontSize()).toBe(20);
    expect(badge.radius()).toBeGreaterThan(12);
  });

  it("shrinks only the numbered marker circle while preserving text and label layout", () => {
    const node = renderObject(object({
      id: "marker-compact-badge",
      type: "marker",
      start: { x: 30, y: 40 },
      end: undefined,
      markerNumber: 8,
      text: "Keep layout",
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        markerFill: "#ff6600",
        fontSize: 20,
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    })) as Konva.Group;

    const layoutRadius = markerBadgeRadius(20);
    const badge = node.findOne(".marker-badge") as Konva.Circle;
    const number = node.findOne(".marker-number") as Konva.Text;
    const labelPart = node.findOne(".marker-label-part") as Konva.Group;

    expect(badge.radius()).toBeLessThan(layoutRadius);
    expect(number.fontSize()).toBe(20);
    expect(number.width()).toBe(layoutRadius * 2);
    expect(number.height()).toBe(layoutRadius * 2);
    expect(number.x() + number.width() / 2).toBe(badge.x());
    expect(number.y() + number.height() / 2).toBe(badge.y());
    expect(labelPart.x()).toBe(30 + layoutRadius + MARKER_BUBBLE_GAP);
  });

  it("renders circle magnifiers with a clipped composited image and border", () => {
    const sourceImage = new Image();
    const existingRect = object({
      id: "rect-in-lens",
      type: "rect",
      start: { x: 16, y: 18 },
      end: { x: 56, y: 48 },
      style: { color: "#ff0000", strokeWidth: 4, fill: "hollow" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });
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
        objects: [existingRect],
      },
    });

    expect(node).toBeInstanceOf(Konva.Group);
    const group = node as Konva.Group;

    expect(group.findOne(".magnifier-clip")).toBeInstanceOf(Konva.Group);
    expect(group.findOne(".magnifier-image")).toBeInstanceOf(Konva.Image);
    expect(group.findOne(".magnifier-annotations")).toBeInstanceOf(Konva.Group);
    expect((group.findOne(".magnifier-annotations") as Konva.Group).getChildren()).toHaveLength(1);
    expect(group.findOne(".magnifier-border")).toBeInstanceOf(Konva.Circle);
    expect((group.findOne(".magnifier-image") as Konva.Image).image()).toBe(sourceImage);
  });

  it("uses a fixed inward-fading gray border for magnifiers", () => {
    const node = renderObject(object({
      id: "magnifier-default-border",
      type: "magnifier",
      start: { x: 40, y: 50 },
      end: { x: 140, y: 150 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        magnifierShape: "circle",
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    })) as Konva.Group;
    const rings = node.find(".magnifier-border-ring") as Konva.Circle[];

    expect(rings).toHaveLength(4);
    expect(rings.map((ring) => ring.stroke())).toEqual([
      "rgba(156, 163, 175, 0.72)",
      "rgba(156, 163, 175, 0.5)",
      "rgba(156, 163, 175, 0.3)",
      "rgba(156, 163, 175, 0.14)",
    ]);
    expect(rings.every((ring) => ring.strokeWidth() === 1)).toBe(true);
  });

  it("keeps circle magnifier bounds square so selection follows the visible lens", () => {
    const node = renderObject(object({
      id: "magnifier-wide-circle",
      type: "magnifier",
      start: { x: 40, y: 50 },
      end: { x: 160, y: 130 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        magnifierShape: "circle",
        magnifierZoom: 2,
        magnifierBorderColor: "#0099ff",
        magnifierBorderWidth: 3,
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    })) as Konva.Group;
    const rings = node.find(".magnifier-border-ring") as Konva.Circle[];
    const outerRing = rings[0];

    expect(node.x()).toBe(60);
    expect(node.y()).toBe(50);
    expect(node.width()).toBe(80);
    expect(node.height()).toBe(80);
    expect(outerRing.x()).toBe(40);
    expect(outerRing.y()).toBe(40);
    expect(outerRing.radius()).toBe(39.5);
  });

  it("renders rectangular magnifiers with a clipped composited image and configurable rounded border", () => {
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

  it("adds an invisible hit area so magnifiers can be selected and dragged", () => {
    const node = renderObject(object({
      id: "magnifier-hit-test",
      type: "magnifier",
      start: { x: 40, y: 50 },
      end: { x: 140, y: 150 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        magnifierShape: "circle",
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    })) as Konva.Group;

    const hitArea = node.findOne(".magnifier-hit") as Konva.Shape;

    expect(hitArea).toBeInstanceOf(Konva.Shape);
    expect(hitArea.listening()).toBe(true);
  });

  it("samples transformed magnifiers from their visual position", () => {
    const sourceImage = new Image();
    const node = renderObject(object({
      id: "magnifier-transformed",
      type: "magnifier",
      start: { x: 40, y: 50 },
      end: { x: 140, y: 150 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        magnifierShape: "circle",
        magnifierZoom: 1.5,
      },
      transform: { x: 20, y: 10, scaleX: 1, scaleY: 1, rotation: 0 },
    }), {
      stageSize: { width: 320, height: 180 },
      magnifier: {
        sourceImage,
        stageSize: { width: 320, height: 180 },
        scaleFactor: 1,
        objects: [],
      },
    }) as Konva.Group;

    const content = node.findOne(".magnifier-content") as Konva.Group;

    expect(content.x()).toBe(-170);
    expect(content.y()).toBe(-170);
  });

  it("samples resized magnifiers from the visual area underneath the lens", () => {
    const sourceImage = new Image();
    const node = renderObject(object({
      id: "magnifier-resized",
      type: "magnifier",
      start: { x: 40, y: 50 },
      end: { x: 140, y: 150 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        magnifierShape: "rounded-rect",
        magnifierZoom: 2,
      },
      transform: { x: 20, y: 10, scaleX: 2, scaleY: 1.5, rotation: 0 },
    }), {
      stageSize: { width: 320, height: 180 },
      magnifier: {
        sourceImage,
        stageSize: { width: 320, height: 180 },
        scaleFactor: 1,
        objects: [],
      },
    }) as Konva.Group;

    const content = node.findOne(".magnifier-content") as Konva.Group;

    expect(node.x()).toBe(60);
    expect(node.y()).toBe(60);
    expect(node.width()).toBe(200);
    expect(node.height()).toBe(150);
    expect(node.scaleX()).toBe(1);
    expect(node.scaleY()).toBe(1);
    expect(content.x()).toBe(-220);
    expect(content.y()).toBe(-195);
  });

  it("crops full-monitor frame sources to the committed selection before magnifying", () => {
    const sourceImage = new Image();
    const node = renderObject(object({
      id: "magnifier-cropped-source",
      type: "magnifier",
      start: { x: 40, y: 50 },
      end: { x: 140, y: 150 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        magnifierShape: "circle",
        magnifierZoom: 2,
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }), {
      stageSize: { width: 240, height: 160 },
      magnifier: {
        sourceImage,
        stageSize: { width: 240, height: 160 },
        scaleFactor: 2,
        sourceRect: { x: 100, y: 120, width: 240, height: 160 },
        objects: [],
      },
    }) as Konva.Group;

    const image = node.findOne(".magnifier-image") as Konva.Image;

    expect(image.crop()).toEqual({ x: 200, y: 240, width: 480, height: 320 });
    expect(image.width()).toBe(240);
    expect(image.height()).toBe(160);
  });

  it("samples transformed blur effects from their visual position", () => {
    const rect = blurSampleRectForObject(object({
      type: "blur",
      start: { x: 60, y: 70 },
      end: { x: 140, y: 100 },
      transform: { x: 25, y: -10, scaleX: 1, scaleY: 1, rotation: 0 },
    }));

    expect(rect).toEqual({ x: 85, y: 60, width: 80, height: 30 });
  });

  it("samples resized blur effects from the resized region instead of stretching", () => {
    const rect = blurSampleRectForObject(object({
      type: "blur",
      start: { x: 60, y: 70 },
      end: { x: 140, y: 100 },
      transform: { x: 25, y: -10, scaleX: 2, scaleY: 3, rotation: 0 },
    }));

    expect(rect).toEqual({ x: 85, y: 60, width: 160, height: 90 });
  });

  it("renders solid resized blur effects at natural scale", () => {
    const node = renderObject(object({
      type: "blur",
      start: { x: 60, y: 70 },
      end: { x: 140, y: 100 },
      style: {
        color: "#ff0000",
        strokeWidth: 4,
        blurMode: "solid",
        blurSolidColor: "#000000",
      },
      transform: { x: 25, y: -10, scaleX: 2, scaleY: 3, rotation: 12 },
    })) as Konva.Rect;

    expect(node.width()).toBe(160);
    expect(node.height()).toBe(90);
    expect(node.scaleX()).toBe(1);
    expect(node.scaleY()).toBe(1);
    expect(node.rotation()).toBe(0);
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

    expect(node.draggable()).toBe(true);
    expect(node.x()).toBe(5);
    expect(node.y()).toBe(6);
    expect(label.text()).toBe("50px");
    expect(label.fill()).toBe("#ffffff");
    expect(label.fontStyle()).not.toBe("bold");
    expect(background.fill()).toBe("#111827");
    expect(background.strokeEnabled()).toBe(false);
    expect(background.strokeWidth()).toBe(0);
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

    expect(label.text()).toBe("50px");
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

  it("keeps highlight client rect aligned with its computed visual bounds", () => {
    const node = renderHighlightObject(object({
      type: "highlight",
      points: [0, 0, 80, 0],
      style: { color: "#ffcc00", strokeWidth: 4, cornerRadius: 12, opacity: 0.35 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    }));

    const rect = node.getClientRect({ skipTransform: true });

    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(node.width());
    expect(rect.height).toBeCloseTo(node.height());
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
