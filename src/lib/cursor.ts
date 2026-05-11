import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import type { Point } from "@/lib/types";

type Size = {
  width: number;
  height: number;
};

export function globalCursorToWindowPoint(
  cursor: Point,
  windowPosition: Point,
  scaleFactor: number,
  bounds: Size,
): Point | null {
  if (scaleFactor <= 0) return null;

  const point = {
    x: (cursor.x - windowPosition.x) / scaleFactor,
    y: (cursor.y - windowPosition.y) / scaleFactor,
  };

  if (point.x < 0 || point.y < 0 || point.x >= bounds.width || point.y >= bounds.height) {
    return null;
  }

  return point;
}

export async function currentCursorPointInWindow(): Promise<Point | null> {
  const currentWindow = getCurrentWindow();
  const [cursor, windowPosition, scaleFactor] = await Promise.all([
    cursorPosition(),
    currentWindow.outerPosition(),
    currentWindow.scaleFactor(),
  ]);

  return globalCursorToWindowPoint(cursor, windowPosition, scaleFactor, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}
