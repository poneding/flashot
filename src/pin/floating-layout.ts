import type { PinToolLayout } from "@/pin/types";

export type FloatingRect = { x: number; y: number; width: number; height: number };
export const PIN_TOOL_PADDING = 0;

/** Include out-of-flow menus, without reserving their space when they are closed. */
export function fitPinToolContents(origin: FloatingRect, anchor: FloatingRect, surfaces: FloatingRect[]): {
  offset: { left: number; top: number };
  layout: PinToolLayout;
} {
  const rects = [origin, anchor, ...surfaces].filter(r => r.width > 0 && r.height > 0);
  const left = Math.min(...rects.map(r => r.x));
  const top = Math.min(...rects.map(r => r.y));
  const right = Math.max(...rects.map(r => r.x + r.width));
  const bottom = Math.max(...rects.map(r => r.y + r.height));
  const offset = { left: Math.ceil(origin.x + PIN_TOOL_PADDING - left), top: Math.ceil(origin.y + PIN_TOOL_PADDING - top) };
  const dx = offset.left - origin.x;
  const dy = offset.top - origin.y;
  return {
    offset,
    layout: {
      width: Math.ceil(right + dx + PIN_TOOL_PADDING),
      height: Math.ceil(bottom + dy + PIN_TOOL_PADDING),
      anchorX: anchor.x + dx,
      anchorY: anchor.y + dy,
      anchorWidth: anchor.width,
      anchorHeight: anchor.height,
    },
  };
}
