import { create } from "zustand";
import { moveRect, rectFromDrag, resizeRect, type HandleId } from "@/lib/geometry";
import { hitTestWindow } from "@/lib/hit-test";
import type { CaptureStartPayload, Mode, Point, Rect, WindowRect } from "@/lib/types";

type SelectionInteraction =
  | { kind: "move"; origin: Point; startRect: Rect }
  | { kind: "resize"; handle: HandleId; startRect: Rect };

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
  selectionInteraction: SelectionInteraction | null;
};

type Actions = {
  start: (p: CaptureStartPayload) => void;
  setCursor: (p: Point) => void;
  setHover: (r: Rect | null) => void;
  updateHoverAt: (p: Point) => void;
  beginDrag: (p: Point) => void;
  updateDrag: (p: Point) => void;
  commitDrag: () => void;
  commit: (r: Rect) => void;
  setSelection: (r: Rect) => void;
  beginMove: (p: Point) => void;
  beginResize: (handle: HandleId, p: Point) => void;
  updateSelectionInteraction: (p: Point) => void;
  finishSelectionInteraction: () => void;
  end: () => void;
};

function localMonitorBounds(monitor: Rect | null): Rect {
  return {
    x: 0,
    y: 0,
    width: monitor?.width ?? window.innerWidth,
    height: monitor?.height ?? window.innerHeight,
  };
}

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
  selectionInteraction: null,

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
      selectionInteraction: null,
    }),

  setCursor: (p) => set({ cursor: p }),
  setHover: (r) => set({ hoverRect: r }),
  updateHoverAt: (p) => {
    const { mode, windows } = get();
    const hover = mode === "hover" ? hitTestWindow(p, windows)?.rect ?? null : get().hoverRect;
    set({ cursor: p, hoverRect: hover });
  },

  beginDrag: (p) => {
    const keepHover = get().mode === "hover";
    set({
      mode: "dragging",
      dragStart: p,
      selection: null,
      selectionInteraction: null,
      hoverRect: keepHover ? get().hoverRect : null,
    });
  },
  updateDrag: (p) => {
    const a = get().dragStart;
    if (!a) return;
    set({ selection: rectFromDrag(a, p) });
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
  commit: (r) => set({ mode: "committed", selection: r, selectionInteraction: null }),
  setSelection: (r) => set({ selection: r }),
  beginMove: (p) => {
    const { mode, selection } = get();
    if (mode !== "committed" || !selection) return;
    set({ selectionInteraction: { kind: "move", origin: p, startRect: selection } });
  },
  beginResize: (handle, _p) => {
    const { mode, selection } = get();
    if (mode !== "committed" || !selection) return;
    set({ selectionInteraction: { kind: "resize", handle, startRect: selection } });
  },
  updateSelectionInteraction: (p) => {
    const { monitorRect, selectionInteraction } = get();
    if (!selectionInteraction) return;
    const bounds = localMonitorBounds(monitorRect);

    if (selectionInteraction.kind === "move") {
      set({
        selection: moveRect(
          selectionInteraction.startRect,
          selectionInteraction.origin,
          p,
          bounds,
        ),
      });
      return;
    }

    set({
      selection: resizeRect(selectionInteraction.startRect, selectionInteraction.handle, p, bounds),
    });
  },
  finishSelectionInteraction: () => set({ selectionInteraction: null }),
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
      selectionInteraction: null,
    }),
}));
