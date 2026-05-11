import { useEffect } from "react";
import { useOverlay } from "@/overlay/state";
import { onCaptureEnd, onCaptureStart, cropAndCopy, cancelCapture } from "@/lib/ipc";
import { currentCursorPointInWindow } from "@/lib/cursor";
import { cursorForHandle, hitTestHandle, rectContainsPoint } from "@/lib/geometry";
import { FrozenLayer } from "@/overlay/FrozenLayer";
import { DimMask } from "@/overlay/DimMask";
import { Crosshair } from "@/overlay/Crosshair";
import { DetectHighlight } from "@/overlay/DetectHighlight";
import { SelectionBox } from "@/overlay/SelectionBox";
import { Toolbar } from "@/overlay/Toolbar";

export function OverlayRoute() {
  const start = useOverlay((s) => s.start);
  const end = useOverlay((s) => s.end);
  const updateHoverAt = useOverlay((s) => s.updateHoverAt);
  const beginDrag = useOverlay((s) => s.beginDrag);
  const updateDrag = useOverlay((s) => s.updateDrag);
  const commitDrag = useOverlay((s) => s.commitDrag);
  const beginMove = useOverlay((s) => s.beginMove);
  const beginResize = useOverlay((s) => s.beginResize);
  const updateSelectionInteraction = useOverlay((s) => s.updateSelectionInteraction);
  const finishSelectionInteraction = useOverlay((s) => s.finishSelectionInteraction);
  const mode = useOverlay((s) => s.mode);
  const monitorId = useOverlay((s) => s.monitorId);
  const selection = useOverlay((s) => s.selection);
  const cursor = useOverlay((s) => s.cursor);
  const selectionInteraction = useOverlay((s) => s.selectionInteraction);
  const frameUrl = useOverlay((s) => s.frameUrl);

  useEffect(() => {
    document.body.classList.add("overlay");
    let unsubStart: undefined | (() => void);
    let unsubEnd: undefined | (() => void);
    onCaptureStart(start).then((u) => (unsubStart = u));
    onCaptureEnd(end).then((u) => (unsubEnd = u));
    return () => {
      document.body.classList.remove("overlay");
      unsubStart?.();
      unsubEnd?.();
    };
  }, [start, end]);

  // Keyboard: Esc cancels; Cmd/Ctrl+C copies when committed
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); cancelCapture(); return; }
      if (mode === "committed" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (selection && monitorId != null) cropAndCopy(monitorId, selection);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selection, monitorId]);

  useEffect(() => {
    if (mode !== "hover" || !frameUrl) return;
    let cancelled = false;

    currentCursorPointInWindow()
      .then((p) => {
        if (!cancelled && p) {
          useOverlay.getState().updateHoverAt(p);
        }
      })
      .catch((error) => {
        console.warn("Failed to read cursor position", error);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, frameUrl]);

  // Mouse handling
  const onMouseMove = (e: React.MouseEvent) => {
    const p = { x: e.clientX, y: e.clientY };
    updateHoverAt(p);
    const state = useOverlay.getState();
    if (state.selectionInteraction) {
      updateSelectionInteraction(p);
      return;
    }
    if (state.mode === "dragging") { updateDrag(p); return; }
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) { cancelCapture(); return; }
    const p = { x: e.clientX, y: e.clientY };
    const state = useOverlay.getState();

    if (state.mode === "committed" && state.selection) {
      const handle = hitTestHandle(p, state.selection, 10);
      if (handle) {
        beginResize(handle, p);
        return;
      }
      if (rectContainsPoint(state.selection, p)) {
        beginMove(p);
        return;
      }
      beginDrag(p);
      return;
    }

    if (state.mode === "hover") beginDrag(p);
  };
  const onMouseUp = () => {
    const state = useOverlay.getState();
    if (state.selectionInteraction) {
      finishSelectionInteraction();
      return;
    }
    if (state.mode === "dragging") commitDrag();
  };
  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); cancelCapture(); };

  const overlayCursor = (() => {
    if (selectionInteraction?.kind === "resize") return cursorForHandle(selectionInteraction.handle);
    if (selectionInteraction?.kind === "move") return "move";
    if (mode === "hover" || mode === "dragging") return "crosshair";
    if (mode === "committed" && selection && cursor) {
      const handle = hitTestHandle(cursor, selection, 10);
      if (handle) return cursorForHandle(handle);
      if (rectContainsPoint(selection, cursor)) return "move";
    }
    return "default";
  })();

  if (mode === "idle") return null;

  return (
    <div
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      style={{ position: "fixed", inset: 0, cursor: overlayCursor }}
    >
      <FrozenLayer />
      <DimMask />
      <DetectHighlight />
      <SelectionBox />
      <Crosshair />
      <Toolbar />
    </div>
  );
}
