import { describe, expect, it } from "vitest";
import { globalCursorToWindowPoint } from "@/lib/cursor";

describe("globalCursorToWindowPoint", () => {
  it("converts a global physical cursor position into overlay-local CSS coordinates", () => {
    expect(
      globalCursorToWindowPoint(
        { x: 760, y: 460 },
        { x: 560, y: 260 },
        2,
        { width: 300, height: 200 },
      ),
    ).toEqual({ x: 100, y: 100 });
  });

  it("returns null when the cursor is outside the overlay window", () => {
    expect(
      globalCursorToWindowPoint(
        { x: 100, y: 100 },
        { x: 560, y: 260 },
        2,
        { width: 300, height: 200 },
      ),
    ).toBeNull();
  });
});
