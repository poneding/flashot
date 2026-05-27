import { create } from "zustand";
import {
  moveRect,
  rectContainsPoint,
  rectFromDrag,
  resizeRect,
  type HandleId,
} from "@/lib/geometry";
import { hitTestWindow } from "@/lib/hit-test";
import { getSettings, setSettings } from "@/lib/ipc";
import { DEFAULT_IMAGE_ADJUSTMENTS, normalizeImageAdjustments } from "@/overlay/imageAdjustments";
import type { CaptureStartPayload, ImageAdjustments, Mode, Point, Rect, WindowRect } from "@/lib/types";

type SelectionInteraction =
  | { kind: "move"; origin: Point; startRect: Rect }
  | { kind: "resize"; handle: HandleId; startRect: Rect };

export type HoverTarget = "window" | "monitor" | null;

type HoverHit = {
  rect: Rect;
  target: Exclude<HoverTarget, null>;
};

type State = {
  mode: Mode;
  monitorId: number | null;
  monitorRect: Rect | null;
  scaleFactor: number;
  frameUrl: string | null;
  windows: WindowRect[];
  cursor: Point | null;
  hoverRect: Rect | null;
  hoverTarget: HoverTarget;
  selection: Rect | null;
  dragStart: Point | null;
  selectionInteraction: SelectionInteraction | null;
  colorFormat: "hex" | "rgb";
  colorPickerVisible: boolean;
  colorCopied: boolean;
  currentColor: { r: number; g: number; b: number } | null;
  cornerRadius: number;
  imageAdjustments: ImageAdjustments;
};

type Actions = {
  start: (p: CaptureStartPayload) => void;
  setCursor: (p: Point) => void;
  setHover: (r: Rect | null, target?: HoverTarget) => void;
  clearHover: () => void;
  updateHoverAt: (p: Point) => void;
  lockToPeer: (monitorId: number) => void;
  unlockFromPeer: (monitorId: number) => void;
  beginDrag: (p: Point) => void;
  updateDrag: (p: Point) => void;
  commitDrag: () => void;
  commit: (r: Rect) => void;
  startScroll: () => void;
  activateScroll: () => void;
  setSelection: (r: Rect) => void;
  beginMove: (p: Point) => void;
  beginResize: (handle: HandleId, p: Point) => void;
  updateSelectionInteraction: (p: Point) => void;
  finishSelectionInteraction: () => void;
  end: () => void;
  toggleColorFormat: () => void;
  toggleColorPicker: () => void;
  hideColorPicker: () => void;
  setColorCopied: (v: boolean) => void;
  setCurrentColor: (c: { r: number; g: number; b: number } | null) => void;
  setCornerRadius: (n: number) => void;
  setImageAdjustments: (next: Partial<ImageAdjustments>) => void;
  resetImageAdjustments: () => void;
};

let cornerRadiusPersistTimer: ReturnType<typeof setTimeout> | null = null;
let cornerRadiusPersistVersion = 0;

function normalizeCornerRadius(n: number): number {
  const finite = Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(60, Math.round(finite)));
}

function persistCornerRadiusDebounced(next: number) {
  const version = ++cornerRadiusPersistVersion;
  if (cornerRadiusPersistTimer != null) clearTimeout(cornerRadiusPersistTimer);
  cornerRadiusPersistTimer = setTimeout(() => {
    cornerRadiusPersistTimer = null;
    void getSettings()
      .then((s) => {
        if (version !== cornerRadiusPersistVersion) return undefined;
        return setSettings({ ...s, cornerRadius: next });
      })
      .catch((err) => console.warn("Failed to persist cornerRadius", err));
  }, 150);
}

export function __resetCornerRadiusPersistenceForTests() {
  if (cornerRadiusPersistTimer != null) clearTimeout(cornerRadiusPersistTimer);
  cornerRadiusPersistTimer = null;
  cornerRadiusPersistVersion += 1;
}

function localMonitorBounds(monitor: Rect | null): Rect {
  return {
    x: 0,
    y: 0,
    width: monitor?.width ?? window.innerWidth,
    height: monitor?.height ?? window.innerHeight,
  };
}

function samePoint(a: Point | null, b: Point | null): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height)
  );
}

function targetRectAtPoint(p: Point, windows: WindowRect[], monitor: Rect | null): HoverHit | null {
  const windowRect = hitTestWindow(p, windows)?.rect;
  if (windowRect) return { rect: windowRect, target: "window" };

  const bounds = localMonitorBounds(monitor);
  return rectContainsPoint(bounds, p) ? { rect: bounds, target: "monitor" } : null;
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
  hoverTarget: null,
  selection: null,
  dragStart: null,
  selectionInteraction: null,
  colorFormat: "hex",
  colorPickerVisible: false,
  colorCopied: false,
  currentColor: null,
  cornerRadius: 0,
  imageAdjustments: DEFAULT_IMAGE_ADJUSTMENTS,

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
      hoverTarget: null,
      selection: null,
      dragStart: null,
      selectionInteraction: null,
      colorPickerVisible: false,
      colorCopied: false,
      currentColor: null,
      cornerRadius: normalizeCornerRadius(p.cornerRadius ?? 0),
      imageAdjustments: DEFAULT_IMAGE_ADJUSTMENTS,
    }),

  setCursor: (p) => {
    if (samePoint(get().cursor, p)) return;
    set({ cursor: p });
  },
  setHover: (r, target = r ? "window" : null) => {
    const nextTarget = r ? target ?? "window" : null;
    const state = get();
    if (sameRect(state.hoverRect, r) && state.hoverTarget === nextTarget) return;
    set({ hoverRect: r, hoverTarget: nextTarget });
  },
  clearHover: () => {
    const state = get();
    if (!state.cursor && !state.hoverRect && !state.hoverTarget) return;
    set({ cursor: null, hoverRect: null, hoverTarget: null });
  },
  updateHoverAt: (p) => {
    const { mode, windows, monitorRect } = get();
    if (mode === "hover") {
      const hover = targetRectAtPoint(p, windows, monitorRect);
      const nextRect = hover?.rect ?? null;
      const nextTarget = hover?.target ?? null;
      const state = get();
      if (samePoint(state.cursor, p) && sameRect(state.hoverRect, nextRect) && state.hoverTarget === nextTarget) {
        return;
      }
      set({ cursor: p, hoverRect: nextRect, hoverTarget: nextTarget });
      return;
    }
    if (samePoint(get().cursor, p)) return;
    set({ cursor: p });
  },
  lockToPeer: (ownerMonitorId) => {
    const { monitorId } = get();
    if (monitorId == null || monitorId === ownerMonitorId) return;
    set({
      mode: "locked",
      cursor: null,
      hoverRect: null,
      hoverTarget: null,
      selection: null,
      dragStart: null,
      selectionInteraction: null,
      colorPickerVisible: false,
    });
  },
  unlockFromPeer: (ownerMonitorId) => {
    const { mode, monitorId } = get();
    if (mode !== "locked" || monitorId == null || monitorId === ownerMonitorId) return;
    set({
      mode: "hover",
      cursor: null,
      hoverRect: null,
      hoverTarget: null,
      selection: null,
      dragStart: null,
      selectionInteraction: null,
      colorPickerVisible: false,
    });
  },

  beginDrag: (p) => {
    const { mode: currentMode, windows, monitorRect, hoverRect } = get();
    if (currentMode !== "hover" && currentMode !== "committed") return;
    const keepHover = currentMode === "hover";
    const detectedHover = keepHover && !hoverRect ? targetRectAtPoint(p, windows, monitorRect) : null;
    set({
      mode: "dragging",
      dragStart: p,
      selection: null,
      selectionInteraction: null,
      colorPickerVisible: false,
      hoverRect: keepHover ? hoverRect ?? detectedHover?.rect ?? null : null,
      hoverTarget: keepHover ? get().hoverTarget ?? detectedHover?.target ?? null : null,
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
      if (r) {
        set({
          selection: r,
          mode: "committed",
          dragStart: null,
          hoverTarget: null,
          colorPickerVisible: false,
        });
      } else set({ mode: "hover", selection: null, dragStart: null, hoverTarget: null, colorPickerVisible: false });
      return;
    }
    set({ mode: "committed", dragStart: null, hoverTarget: null, colorPickerVisible: false });
  },
  commit: (r) =>
    set({
      mode: "committed",
      selection: r,
      hoverTarget: null,
      selectionInteraction: null,
      colorPickerVisible: false,
    }),
  startScroll: () => {
    if (get().mode !== "committed") return;
    set({
      mode: "scrollStarting",
      colorPickerVisible: false,
      selectionInteraction: null,
    });
  },
  activateScroll: () => {
    if (get().mode !== "scrollStarting") return;
    set({ mode: "scrolling" });
  },
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
      hoverTarget: null,
      selection: null,
      dragStart: null,
      selectionInteraction: null,
      colorPickerVisible: false,
      colorCopied: false,
      currentColor: null,
      imageAdjustments: DEFAULT_IMAGE_ADJUSTMENTS,
    }),
  toggleColorFormat: () => {
    const current = get().colorFormat;
    set({ colorFormat: current === "hex" ? "rgb" : "hex" });
  },
  toggleColorPicker: () => {
    const { mode, colorPickerVisible } = get();
    if (mode !== "committed") return;
    set({ colorPickerVisible: !colorPickerVisible, colorCopied: false });
  },
  hideColorPicker: () => set({ colorPickerVisible: false, colorCopied: false }),
  setColorCopied: (v) => set({ colorCopied: v }),
  setCurrentColor: (c) => set({ currentColor: c }),
  setCornerRadius: (n) => {
    const clamped = normalizeCornerRadius(n);
    set({ cornerRadius: clamped });
    persistCornerRadiusDebounced(clamped);
  },
  setImageAdjustments: (next) => set((state) => ({
    imageAdjustments: normalizeImageAdjustments({ ...state.imageAdjustments, ...next }),
  })),
  resetImageAdjustments: () => set({ imageAdjustments: DEFAULT_IMAGE_ADJUSTMENTS }),
}));
