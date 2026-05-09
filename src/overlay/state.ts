import { create } from "zustand";
import type { CaptureStartPayload, Mode, Point, Rect, WindowRect } from "@/lib/types";

type State = {
  mode: Mode;
  monitorId: number | null;
  monitorRect: Rect | null;
  scaleFactor: number;
  frameUrl: string | null;
  windows: WindowRect[];
  cursor: Point | null;
  hoverRect: Rect | null;
  selection: Rect | null;
  dragStart: Point | null;
};

type Actions = {
  start: (p: CaptureStartPayload) => void;
  setCursor: (p: Point) => void;
  setHover: (r: Rect | null) => void;
  beginDrag: (p: Point) => void;
  updateDrag: (p: Point) => void;
  commitDrag: () => void;
  commit: (r: Rect) => void;
  setSelection: (r: Rect) => void;
  end: () => void;
};

export const useOverlay = create<State & Actions>((set, get) => ({
  mode: "idle",
  monitorId: null,
  monitorRect: null,
  scaleFactor: 1,
  frameUrl: null,
  windows: [],
  cursor: null,
  hoverRect: null,
  selection: null,
  dragStart: null,

  start: (p) =>
    set({
      mode: "hover",
      monitorId: p.monitorId,
      monitorRect: p.monitorRect,
      scaleFactor: p.scaleFactor,
      frameUrl: p.frameUrl,
      windows: p.windows,
      cursor: null,
      hoverRect: null,
      selection: null,
      dragStart: null,
    }),

  setCursor: (p) => set({ cursor: p }),
  setHover: (r) => set({ hoverRect: r }),

  beginDrag: (p) => set({ mode: "dragging", dragStart: p, selection: null }),
  updateDrag: (p) => {
    const a = get().dragStart;
    if (!a) return;
    const x = Math.min(a.x, p.x), y = Math.min(a.y, p.y);
    const w = Math.abs(a.x - p.x), h = Math.abs(a.y - p.y);
    set({ selection: { x, y, width: w, height: h } });
  },
  commitDrag: () => {
    const sel = get().selection;
    if (!sel || sel.width < 4 || sel.height < 4) {
      // tiny drag → take hovered window if any, else stay in hover
      const r = get().hoverRect;
      if (r) set({ selection: r, mode: "committed" });
      else set({ mode: "hover", selection: null, dragStart: null });
      return;
    }
    set({ mode: "committed", dragStart: null });
  },
  commit: (r) => set({ mode: "committed", selection: r }),
  setSelection: (r) => set({ selection: r }),
  end: () =>
    set({
      mode: "idle",
      monitorId: null,
      monitorRect: null,
      frameUrl: null,
      windows: [],
      cursor: null,
      hoverRect: null,
      selection: null,
      dragStart: null,
    }),
}));
