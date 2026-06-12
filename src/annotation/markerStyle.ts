import type { Point } from "@/lib/types";

export const MARKER_BADGE_TEXT_COLOR = "#ffffff";
export const MARKER_BUBBLE_BACKGROUND = "#111827";
export const MARKER_BUBBLE_TEXT_COLOR = "#ffffff";
export const MARKER_DEFAULT_FONT_SIZE = 14;
export const MARKER_NUMBER_MIN = 0;
export const MARKER_NUMBER_MAX = 99;
export const MARKER_BADGE_MIN_RADIUS = 12;
export const MARKER_BADGE_VISUAL_RADIUS_INSET = 2;
export const MARKER_BUBBLE_GAP = 8;
export const MARKER_BUBBLE_PADDING_X = 8;
export const MARKER_BUBBLE_PADDING_Y = 5;
export const MARKER_BUBBLE_LINE_HEIGHT = 1.2;
export const MARKER_BUBBLE_RADIUS = 7;
export const MARKER_BUBBLE_MIN_WIDTH = 36;
export const MARKER_BUBBLE_FONT_FAMILY = "Arial, sans-serif";

export function markerBadgeFontSize(fontSize?: number, markerNumber = 1): number {
  const base = Number.isFinite(fontSize) ? Math.max(1, fontSize ?? MARKER_DEFAULT_FONT_SIZE) : MARKER_DEFAULT_FONT_SIZE;
  if (markerNumber >= 100) return Math.max(7, Math.round(base * 0.7));
  return base;
}

export function markerBadgeRadius(fontSize?: number): number {
  const base = Number.isFinite(fontSize) ? Math.max(1, fontSize ?? MARKER_DEFAULT_FONT_SIZE) : MARKER_DEFAULT_FONT_SIZE;
  return Math.max(MARKER_BADGE_MIN_RADIUS, Math.ceil(base * 0.9));
}

export function markerBadgeVisualRadius(fontSize?: number): number {
  return Math.max(1, markerBadgeRadius(fontSize) - MARKER_BADGE_VISUAL_RADIUS_INSET);
}

export function markerTextWidth(text: string, fontSize: number): number {
  const measuredText = text.trim() || " ";
  if (typeof document === "undefined") {
    return measuredText.length * fontSize * 0.55;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return measuredText.length * fontSize * 0.55;
  ctx.font = `${fontSize}px ${MARKER_BUBBLE_FONT_FAMILY}`;
  return ctx.measureText(measuredText).width;
}

export function markerLabelMetrics(text: string, fontSize = MARKER_DEFAULT_FONT_SIZE) {
  const textWidth = markerTextWidth(text, fontSize);
  const lineHeight = fontSize * MARKER_BUBBLE_LINE_HEIGHT;

  return {
    width: Math.max(MARKER_BUBBLE_MIN_WIDTH, textWidth + MARKER_BUBBLE_PADDING_X * 2),
    height: lineHeight + MARKER_BUBBLE_PADDING_Y * 2,
    lineHeight,
  };
}

export function defaultMarkerLabelAnchor(start: Point, text: string, fontSize = MARKER_DEFAULT_FONT_SIZE): Point {
  const { height } = markerLabelMetrics(text, fontSize);

  return {
    x: start.x + markerBadgeRadius(fontSize) + MARKER_BUBBLE_GAP,
    y: start.y - height / 2,
  };
}
