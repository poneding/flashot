import type { Point, WindowRect } from "@/lib/types";

export function hitTestWindow(p: Point, windows: WindowRect[]): WindowRect | null {
  for (const w of windows) {
    const r = w.rect;
    if (p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height) {
      return w;
    }
  }
  return null;
}
