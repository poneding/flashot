import { useEffect } from "react";
import { useOverlay } from "@/overlay/state";
import { onCaptureEnd, onCaptureStart, cropAndCopy, cancelCapture } from "@/lib/ipc";
import { hitTestWindow } from "@/lib/hit-test";
import { FrozenLayer } from "@/overlay/FrozenLayer";
import { DimMask } from "@/overlay/DimMask";
import { Crosshair } from "@/overlay/Crosshair";
import { DetectHighlight } from "@/overlay/DetectHighlight";
import { SelectionBox } from "@/overlay/SelectionBox";
import { Toolbar } from "@/overlay/Toolbar";

export function OverlayRoute() {
  const start = useOverlay((s) => s.start);
  const end = useOverlay((s) => s.end);
  const setCursor = useOverlay((s) => s.setCursor);
  const setHover = useOverlay((s) => s.setHover);
  const beginDrag = useOverlay((s) => s.beginDrag);
  const updateDrag = useOverlay((s) => s.updateDrag);
  const commitDrag = useOverlay((s) => s.commitDrag);
  const commit = useOverlay((s) => s.commit);
  const mode = useOverlay((s) => s.mode);
  const monitorId = useOverlay((s) => s.monitorId);
  const selection = useOverlay((s) => s.selection);

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

  // Mouse handling
  const onMouseMove = (e: React.MouseEvent) => {
    const p = { x: e.clientX, y: e.clientY };
    setCursor(p);
    if (mode === "dragging") { updateDrag(p); return; }
    if (mode === "hover") {
      const w = hitTestWindow(p, useOverlay.getState().windows);
      setHover(w?.rect ?? null);
    }
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) { cancelCapture(); return; }
    if (mode === "hover") beginDrag({ x: e.clientX, y: e.clientY });
  };
  const onMouseUp = () => {
    if (mode === "dragging") commitDrag();
  };
  const onClick = () => {
    if (mode === "hover") {
      const r = useOverlay.getState().hoverRect;
      if (r) commit(r);
    }
  };
  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); cancelCapture(); };

  if (mode === "idle") return null;

  return (
    <div
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{ position: "fixed", inset: 0, cursor: "crosshair" }}
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
