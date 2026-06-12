import { describe, expect, it } from "vitest";
import { stageCursorForTool } from "@/annotation/Stage";
import { DEFAULT_STYLE, type AnnotationStyle } from "@/annotation/types";

function style(overrides: Partial<AnnotationStyle> = {}): AnnotationStyle {
  return { ...DEFAULT_STYLE, ...overrides };
}

describe("stageCursorForTool", () => {
  it("uses a text cursor for the straight highlight tool", () => {
    expect(stageCursorForTool("highlight", style({ highlightMode: "straight" }), false)).toBe("text");
  });

  it("uses a crosshair for the freehand highlight tool", () => {
    expect(stageCursorForTool("highlight", style({ highlightMode: "freehand" }), false)).toBe("crosshair");
  });

  it("uses a text cursor for the text tool", () => {
    expect(stageCursorForTool("text", style(), false)).toBe("text");
  });

  it("uses a move cursor for the select tool", () => {
    expect(stageCursorForTool("select", style(), false)).toBe("move");
  });

  it("uses a grab cursor for the eraser tool", () => {
    expect(stageCursorForTool("eraser", style(), false)).toBe("grab");
  });

  it("uses a zoom cursor for the circle magnifier", () => {
    expect(stageCursorForTool("magnifier", style({ magnifierShape: "circle" }), false)).toBe("zoom-in");
  });

  it("uses a crosshair for the rounded-rect magnifier", () => {
    expect(stageCursorForTool("magnifier", style({ magnifierShape: "rounded-rect" }), false)).toBe("crosshair");
  });

  it("falls back to a crosshair for drawing tools", () => {
    expect(stageCursorForTool("rect", style(), false)).toBe("crosshair");
    expect(stageCursorForTool("arrow", style(), false)).toBe("crosshair");
    expect(stageCursorForTool("blur", style(), false)).toBe("crosshair");
  });

  it("forces a crosshair whenever the color picker is open, even for straight highlight", () => {
    expect(stageCursorForTool("highlight", style({ highlightMode: "straight" }), true)).toBe("crosshair");
    expect(stageCursorForTool("text", style(), true)).toBe("crosshair");
  });
});
